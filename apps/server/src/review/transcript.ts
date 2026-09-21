// Turning opencode's raw SSE firehose into something small enough to broadcast.
//
// The review detail page used to re-fetch the WHOLE session transcript every 2s
// while a review ran — a flood of duplicated payload through the shared
// one-server-per-process client. So instead we forward the interesting events
// off the pump that already exists for the watchdog.
//
// Two things make "just forward the event" wrong:
//
//  1. Size. opencode v2 re-publishes a message's WHOLE content array on every
//     change (`session.message.content.updated`), each tool part carrying its
//     accumulated output and input. Forwarding verbatim floods the hub with
//     duplicated payloads.
//  2. Rate. Text and reasoning parts update per token.
//
// So this module truncates (only the fields the UI actually renders survive,
// each capped), dedupes (a part whose status/output hasn't changed since the
// last forwarded frame is skipped) and coalesces (at most one delta per part
// per interval, with terminal tool statuses always let through so a tool never
// sticks on "running"). A plain fold with no I/O, kept out of observeEvent so
// that one stays a pure watchdog fold, and tested on its own.

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

// Paranoia bound on the dedupe maps: one entry per part/message for the life
// of a review. A pathological session can't grow them without bound.
const MAX_TRACKED = 2_000;

function clamp(s: unknown, max: number): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// v2 content parts as they arrive on the wire (subset we read).
interface RawToolState {
  status?: unknown;
  input?: unknown; // string while streaming, object once resolved
  content?: unknown; // [{type:"text", text}, ...] once finished
  error?: { message?: unknown } | null;
}
interface RawPart {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  state?: RawToolState;
}

// v2 tool statuses → the v1-era words the UI already renders.
function mapToolStatus(status: unknown): string | undefined {
  switch (status) {
    case "streaming":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "error";
    default:
      return undefined;
  }
}

function inputSummary(state: RawToolState): string | undefined {
  const input = state.input;
  const json = typeof input === "string" ? input : (() => {
    try {
      return JSON.stringify(input) ?? "";
    } catch {
      return "<unserializable>";
    }
  })();
  return clamp(json, 200);
}

function outputText(state: RawToolState): string | undefined {
  if (!Array.isArray(state.content)) return undefined;
  const texts = state.content
    .filter((c): c is { type: "text"; text: string } =>
      (c as { type?: unknown })?.type === "text" && typeof (c as { text?: unknown }).text === "string",
    )
    .map((c) => c.text);
  return clamp(texts.join("\n"), MAX_OUTPUT);
}

function toPart(raw: RawPart, syntheticId: string): TranscriptPart | null {
  if (raw.type !== "text" && raw.type !== "reasoning" && raw.type !== "tool") return null;

  if (raw.type === "tool") {
    if (typeof raw.id !== "string") return null;
    const state: TranscriptPart["state"] = {};
    const status = mapToolStatus(raw.state?.status);
    if (status !== undefined) state.status = status;
    const title = inputSummary(raw.state ?? {});
    if (title !== undefined) state.title = title;
    const output = outputText(raw.state ?? {});
    if (output !== undefined) state.output = output;
    const error = clamp(raw.state?.error?.message, MAX_ERROR);
    if (error !== undefined) state.error = error;
    return {
      id: raw.id,
      type: "tool",
      ...(typeof raw.name === "string" ? { tool: raw.name } : {}),
      state,
    };
  }

  // text / reasoning: v2 parts carry no id, so the fold assigns
  // `${messageID}:${index}` — the api.ts snapshot mapper uses the same scheme,
  // which is what lets the live delta merge into the fetched transcript.
  const part: TranscriptPart = { id: syntheticId, type: raw.type };
  const text = clamp(raw.text, MAX_TEXT);
  if (text !== undefined) part.text = text;
  return part;
}

// Cheap change detector so whole-array republishes don't re-forward unchanged
// parts: text grows, tools change status or output.
function partSignature(part: TranscriptPart): string {
  if (part.type === "tool") {
    return `${part.state?.status ?? ""}:${part.state?.output?.length ?? 0}:${part.state?.error?.length ?? 0}`;
  }
  return `${part.text?.length ?? 0}`;
}

const TERMINAL = new Set(["completed", "error"]);

export interface TranscriptStream {
  /**
   * Fold one opencode SSE event. Returns the deltas to publish (a part can
   * change alongside others in the same whole-array republish), or an empty
   * array when the event is for another session, carries nothing renderable,
   * or was coalesced away.
   */
  observe(event: unknown, sessionId: string | undefined, now: number): TranscriptDelta[];
}

export function createTranscriptStream(coalesceMs = COALESCE_MS): TranscriptStream {
  const lastAt = new Map<string, number>();
  const seenMessages = new Map<string, string>();
  // messageId -> (partKey -> signature of last FORWARDED state). A signature
  // is recorded only when a delta actually passes the gate, so a coalesced
  // change stays pending and a later republish of the same state still
  // forwards it.
  const signatures = new Map<string, Map<string, string>>();

  const gate = (key: string, now: number, force: boolean): boolean => {
    const prev = lastAt.get(key);
    if (!force && prev !== undefined && now - prev < coalesceMs) return false;
    if (lastAt.size > MAX_TRACKED) lastAt.clear();
    lastAt.set(key, now);
    return true;
  };

  return {
    observe(event, sessionId, now) {
      if (!sessionId) return [];
      const ev = event as { type?: string; data?: unknown } | null;
      if (!ev?.type || typeof ev.data !== "object" || ev.data === null) return [];
      const data = ev.data as {
        sessionID?: unknown;
        assistantMessageID?: unknown;
        messageID?: unknown;
        content?: unknown;
      };
      if (data.sessionID !== sessionId) return [];

      // Message shell: announce each assistant message once so the UI can
      // create a container before its parts stream in.
      if (ev.type === "session.step.started") {
        if (typeof data.assistantMessageID !== "string") return [];
        if (seenMessages.get(data.assistantMessageID) === "assistant") return [];
        if (seenMessages.size > MAX_TRACKED) seenMessages.clear();
        seenMessages.set(data.assistantMessageID, "assistant");
        return [{ messageId: data.assistantMessageID, role: "assistant" }];
      }

      if (ev.type !== "session.message.content.updated") return [];
      if (typeof data.messageID !== "string" || !Array.isArray(data.content)) return [];
      const messageId = data.messageID;
      let sigs = signatures.get(messageId);
      if (!sigs) {
        if (signatures.size > MAX_TRACKED) signatures.clear();
        sigs = new Map();
        signatures.set(messageId, sigs);
      }

      const deltas: TranscriptDelta[] = [];
      data.content.forEach((raw: RawPart, idx: number) => {
        const part = toPart(raw, `${messageId}:${idx}`);
        if (!part) return;
        const sig = partSignature(part);
        if (sigs.get(part.id) === sig) return;
        // A tool reaching completed/error is the frame that must never be
        // dropped, or the UI leaves it spinning until the next slow poll.
        const force = part.type === "tool" && TERMINAL.has(part.state?.status ?? "");
        if (!gate(`${messageId}:${part.id}`, now, force)) return;
        sigs.set(part.id, sig);
        deltas.push({ messageId, part });
      });
      return deltas;
    },
  };
}
