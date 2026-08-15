// Turning opencode's raw SSE firehose into something small enough to broadcast.
//
// The review detail page used to re-fetch the WHOLE session transcript every 2s
// while a review ran, and since /reviews/:id/session spawns its own opencode
// server per request, a live review booted one every two seconds. So instead we
// forward the interesting events off the pump that already exists for the
// watchdog.
//
// Two things make "just forward the event" wrong:
//
//  1. Size. opencode re-publishes a tool part on EVERY output chunk of a bash
//     command (same reason observeEvent guards on inFlight.has), and each of
//     those carries the full accumulated output plus the full input. Forwarding
//     verbatim floods the hub with large duplicated payloads.
//  2. Rate. Text and reasoning parts update per token.
//
// So this module truncates (only the fields the UI actually renders survive,
// each capped) and coalesces (at most one delta per part per interval, with
// terminal tool statuses always let through so a tool never sticks on
// "running"). It is a plain fold with no I/O, kept out of observeEvent so that
// one stays a pure watchdog fold, and tested on its own.

// Mirrors the subset of an opencode part the transcript UI renders. Everything
// else — inputs, snapshots, per-part timing, token accounting — is dropped: the
// client's REST snapshot remains the source of truth for the full picture.
export interface TranscriptPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string; output?: string; error?: string };
}

export interface TranscriptDelta {
  messageId: string;
  /** Present on message-level deltas; lets the client create a message shell. */
  role?: string;
  /** Absent on message-level deltas. */
  part?: TranscriptPart;
}

// Generous enough that a streaming answer stays readable, small enough that a
// runaway `cat` of a lockfile can't push megabytes through the hub. The UI
// clamps both of these to a scroll box anyway (max-h-80 / max-h-60).
export const MAX_TEXT = 4_000;
export const MAX_OUTPUT = 2_000;
export const MAX_ERROR = 1_000;

// One delta per part per interval. 400ms is well under human "feels laggy"
// while collapsing the per-token storm into a few frames a second.
export const COALESCE_MS = 400;

// Paranoia bound on the dedupe map: one entry per part id for the life of a
// review. A pathological session can't grow it without bound.
const MAX_TRACKED = 2_000;

function clamp(s: unknown, max: number): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Rendered as nothing by the UI, emitted constantly by opencode.
const IGNORED_PART_TYPES = new Set(["step-start", "step-finish", "snapshot", "patch"]);

interface RawPart {
  id?: unknown;
  messageID?: unknown;
  sessionID?: unknown;
  type?: unknown;
  text?: unknown;
  tool?: unknown;
  state?: { status?: unknown; title?: unknown; output?: unknown; error?: unknown };
}

function toPart(raw: RawPart): TranscriptPart | null {
  if (typeof raw.id !== "string" || typeof raw.type !== "string") return null;
  if (IGNORED_PART_TYPES.has(raw.type)) return null;
  const part: TranscriptPart = { id: raw.id, type: raw.type };
  const text = clamp(raw.text, MAX_TEXT);
  if (text !== undefined) part.text = text;
  if (typeof raw.tool === "string") part.tool = raw.tool;
  if (raw.state) {
    // Deliberately NOT state.input: the transcript view never renders it, and
    // for bash it is the single largest repeated field on the wire.
    const state: TranscriptPart["state"] = {};
    if (typeof raw.state.status === "string") state.status = raw.state.status;
    const title = clamp(raw.state.title, 200);
    if (title !== undefined) state.title = title;
    const output = clamp(raw.state.output, MAX_OUTPUT);
    if (output !== undefined) state.output = output;
    const error = clamp(raw.state.error, MAX_ERROR);
    if (error !== undefined) state.error = error;
    part.state = state;
  }
  return part;
}

const TERMINAL = new Set(["completed", "error"]);

export interface TranscriptStream {
  /**
   * Fold one opencode SSE event. Returns the delta to publish, or null when the
   * event is for another session, carries nothing renderable, or was coalesced
   * away.
   */
  observe(event: unknown, sessionId: string | undefined, now: number): TranscriptDelta | null;
}

export function createTranscriptStream(coalesceMs = COALESCE_MS): TranscriptStream {
  const lastAt = new Map<string, number>();
  const seenMessages = new Map<string, string>();

  const gate = (key: string, now: number, force: boolean): boolean => {
    const prev = lastAt.get(key);
    if (!force && prev !== undefined && now - prev < coalesceMs) return false;
    if (lastAt.size > MAX_TRACKED) lastAt.clear();
    lastAt.set(key, now);
    return true;
  };

  return {
    observe(event, sessionId, now) {
      if (!sessionId) return null;
      const ev = event as { type?: string; properties?: Record<string, unknown> } | null;
      const props = ev?.properties;
      if (!props) return null;

      if (ev?.type === "message.updated") {
        const info = props.info as { id?: unknown; sessionID?: unknown; role?: unknown } | undefined;
        if (!info || info.sessionID !== sessionId || typeof info.id !== "string") return null;
        const role = typeof info.role === "string" ? info.role : undefined;
        // message.updated re-fires on every token-count change; the shell only
        // needs announcing once per (id, role).
        if (seenMessages.get(info.id) === (role ?? "")) return null;
        if (seenMessages.size > MAX_TRACKED) seenMessages.clear();
        seenMessages.set(info.id, role ?? "");
        return { messageId: info.id, role };
      }

      if (ev?.type !== "message.part.updated") return null;
      const raw = props.part as RawPart | undefined;
      if (!raw || raw.sessionID !== sessionId) return null;
      if (typeof raw.messageID !== "string") return null;
      const part = toPart(raw);
      if (!part) return null;
      // A tool reaching completed/error is the frame that must never be
      // dropped, or the UI leaves it spinning until the next slow poll.
      const force = part.type === "tool" && TERMINAL.has(part.state?.status ?? "");
      if (!gate(part.id, now, force)) return null;
      return { messageId: raw.messageID, part };
    },
  };
}
