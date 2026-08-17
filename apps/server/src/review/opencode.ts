import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import { resolveApiKey, resolveDefaultModel } from "~/settings";
import { log } from "~/server/log";
import { createServer } from "node:net";

// ponytail: grab an ephemeral port so concurrent reviews don't all try to bind
// the opencode SDK's hardcoded default 4096 (which made `opencode serve` exit 1
// on any overlapping run). Tiny TOCTOU window between close and bind; the rare
// loser fails its own review and retry covers it.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function parseModel(spec: string): { providerID: string; modelID: string } {
  const [providerID, modelID] = spec.split("/");
  if (!providerID || !modelID) {
    throw new Error(`Invalid model spec "${spec}", expected "provider/model"`);
  }
  return { providerID, modelID };
}

export interface RunOptions {
  directory: string;
  prompt: string;
  model?: string;
  agent?: string;
  // Per-review context for the custom tools (post_review / post_comment /
  // get_prior_reviews). Injected into the opencode subprocess's env at spawn
  // rather than mutated onto the long-lived parent process.env, so two reviews
  // of different PRs running at once can't clobber each other's GitHub context
  // (see OpenCodeService and issue #23).
  env?: Record<string, string>;
  // Returns true once the agent has actually posted (a findings row exists for
  // this review). Checked after the session ends: if the agent wrapped up
  // without calling post_review, the same session is continued with one nudge
  // message instead of silently completing with nothing on the PR.
  hasPosted?: () => boolean;
  // Where to publish live transcript deltas. Optional: without it the event
  // pump still feeds the watchdog and simply broadcasts nothing, which is what
  // any caller that has no review row to attach the transcript to should do.
  transcript?: { reviewId: number; repo: string };
}

// GitHub + write-back context the custom tools read from FOUINE_* env vars.
export interface ReviewToolContext {
  githubToken: string;
  owner: string;
  repo: string;
  prNumber: number;
  reviewId: number;
  internalUrl: string;
  internalSecret: string;
}

// The FOUINE_* env the custom tools read (opencode-config/tools/*). Kept next to
// the opencode plumbing that ships it so the key names stay in one place.
export function reviewToolEnv(ctx: ReviewToolContext): Record<string, string> {
  return {
    FOUINE_GITHUB_TOKEN: ctx.githubToken,
    FOUINE_REPO_OWNER: ctx.owner,
    FOUINE_REPO_NAME: ctx.repo,
    FOUINE_PR_NUMBER: String(ctx.prNumber),
    FOUINE_REVIEW_ID: String(ctx.reviewId),
    FOUINE_INTERNAL_URL: ctx.internalUrl,
    FOUINE_INTERNAL_SECRET: ctx.internalSecret,
  };
}

// Env for the outer-loop improver: repo-scoped, deliberately no FOUINE_PR_NUMBER
// so the PR-bound tools (post_review/post_comment) fail loudly if the agent
// somehow reaches for them.
export function improveToolEnv(ctx: Omit<ReviewToolContext, "prNumber">): Record<string, string> {
  const { FOUINE_PR_NUMBER: _pr, ...env } = reviewToolEnv({ ...ctx, prNumber: 0 });
  return env;
}

export interface RunResult {
  sessionId: string;
  text: string;
  cost: number;
  tokens: number;
}

export async function withOpencode<T>(
  fn: (client: OpencodeClient) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const { client, server } = await createOpencode({ port: await freePort(), signal });
  try {
    return await fn(client);
  } finally {
    server.close();
  }
}

function unwrap<T, E>(res: { data?: T; error?: E }, op: string): T {
  if (!res.data) throw new Error(`opencode ${op} failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

async function setProviderApiKey(client: OpencodeClient, providerID: string): Promise<void> {
  const key = resolveApiKey();
  if (!key) return;
  unwrap(
    await client.auth.set({
      path: { id: providerID },
      body: { type: "api", key },
    }),
    `auth.set(${providerID})`,
  );
}

export async function runReview(
  client: OpencodeClient,
  opts: RunOptions,
  onSession?: (id: string) => Promise<void> | void,
): Promise<RunResult> {
  const model = parseModel(opts.model ?? resolveDefaultModel());
  await setProviderApiKey(client, model.providerID);

  const session = unwrap(
    await client.session.create({
      body: { title: "fouine review" },
      query: { directory: opts.directory },
    }),
    "session.create",
  );

  if (onSession) await onSession(session.id);

  const prompt = (text: string, op: string) =>
    client.session
      .prompt({
        path: { id: session.id },
        body: {
          parts: [{ type: "text", text }],
          model,
          ...(opts.agent ? { agent: opts.agent } : {}),
        },
      })
      .then((res) => unwrap(res, op));

  const res = await prompt(opts.prompt, "session.prompt");

  // Some sessions end without the agent ever calling post_review — the PR gets
  // no review and no comments. Continue the same session (full context intact)
  // with one nudge. ponytail: one nudge, no retry loop — a model that ignores a
  // direct instruction twice won't do better on a third.
  let parts = res.parts;
  if (opts.hasPosted && !opts.hasPosted()) {
    const nudge = await prompt(
      "You ended the session without posting the review to GitHub. Post it now with the " +
        "post_review tool (summary + your inline findings). If you found nothing to flag, " +
        "post a short summary-only review — pick `event` by the severity rule in your " +
        "instructions, don't default to COMMENT. If you already posted it, just say so.",
      "session.prompt(nudge)",
    );
    parts = [...parts, ...nudge.parts];
  }

  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");

  // Sum cost/tokens across assistant messages so the runner can persist them —
  // the SDK's Session object doesn't carry totals, they live per-message.
  const msgs = unwrap(
    await client.session.messages({ path: { id: session.id } }),
    "session.messages",
  );
  let cost = 0;
  let tokens = 0;
  for (const m of msgs) {
    const info = m.info as {
      role?: string;
      cost?: number;
      tokens?: { input?: number; output?: number; reasoning?: number };
    };
    if (info.role !== "assistant") continue;
    cost += info.cost ?? 0;
    const t = info.tokens;
    if (t) tokens += (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0);
  }

  return { sessionId: session.id, text, cost, tokens };
}

// ─── idle watchdog ──────────────────────────────────────────────────────────
//
// A review that never returns is one of two things, and they need opposite
// treatment: it is either *legitimately long* (big diff, hundreds of tool
// calls) or *wedged* (opencode stops making progress mid tool call and the
// blocking session.prompt() never resolves). A flat wall-clock ceiling cannot
// tell them apart, so every value is wrong twice: too short for the first and
// far too long for the second. #64 raised it 10 → 30 min and reviews still died
// having burned $0.002 of model spend across the whole 1800s window — i.e. the
// model had stopped thinking almost immediately and we waited half an hour.
//
// So the primary rule is *idleness*, not elapsed time: no event for this
// session within idleTimeoutMs means wedged, kill it now. Elapsed time stays
// only as an absolute backstop for the pathological case (something spewing
// events forever without ever finishing).
//
// The heartbeat is opencode's SSE event stream (`client.event.subscribe()`).
// VERIFIED against the pinned @opencode-ai/sdk 1.18.11 types and empirically
// against the 1.18.18 binary: there is no per-tool-call event in this API
// version (the `session.next.*` family is v2-only). Tool lifecycle rides on
// `message.part.updated` carrying a ToolPart whose `state.status` walks
// pending → running → completed | error, and `state.input` holds the actual
// tool arguments — for bash, the command text. That is what we log.
//
// Any event counts as activity, deliberately: a model can reason for minutes
// without touching a tool, and restricting the heartbeat to tool events would
// kill healthy reviews.

/** A tool call opencode has started but not yet finished. */
interface InFlightTool {
  tool: string;
  /** JSON of the tool's arguments, truncated — for bash this is the command. */
  input: string;
  startedAt: number;
}

export interface ActivityState {
  startedAt: number;
  lastActivity: number;
  // The idle rule only means anything once we have PROVEN we can see this
  // session's events — set by the first event that matches the session, not by
  // the subscription opening.
  //
  // That distinction is the whole bug this flag was introduced for and then got
  // wrong: an open socket carrying somebody else's events looks identical to a
  // silent model. opencode routes `/event` per project directory, so subscribing
  // without the review's `directory` yields a live stream of the WRONG
  // instance's events — none of which match. `lastActivity` then never advances
  // and every review is killed at exactly idleTimeoutMs, mid-work, reported as
  // "no tool calls seen". Arming on first match makes that failure degrade to
  // the absolute ceiling (the old wall-clock behaviour) instead of killing.
  armed: boolean;
  inFlight: Map<string, InFlightTool>;
  lastTool?: string;
}

export function newActivityState(now: number): ActivityState {
  return { startedAt: now, lastActivity: now, armed: false, inFlight: new Map() };
}

// ponytail: 500 chars of raw JSON, no per-tool formatting. It keeps the whole
// argument object, which is what makes the known failure mode readable: the
// model retrying the same grep with a growing `timeout` shows up as
// near-identical lines with a climbing number.
const MAX_INPUT = 500;

function summarizeInput(input: unknown): string {
  const json = (() => {
    try {
      return JSON.stringify(input) ?? "";
    } catch {
      return "<unserializable>";
    }
  })();
  return json.length > MAX_INPUT ? `${json.slice(0, MAX_INPUT)}…` : json;
}

// Events carry their session id in one of three places depending on the event,
// so probe all of them rather than switching on ~30 event names (and the binary
// emits events the pinned types don't even know about, e.g. `plugin.added`).
export function eventSessionId(event: unknown): string | undefined {
  const props = (event as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props) return undefined;
  const direct = props.sessionID;
  if (typeof direct === "string") return direct;
  for (const key of ["part", "info"] as const) {
    const nested = props[key] as { sessionID?: unknown } | undefined;
    if (nested && typeof nested.sessionID === "string") return nested.sessionID;
  }
  return undefined;
}

/**
 * Fold one SSE event into the activity state. Events for other sessions (or
 * server-wide ones like `plugin.added`) are ignored so an unrelated concurrent
 * review can't keep a wedged one alive.
 */
export function observeEvent(
  state: ActivityState,
  event: unknown,
  sessionId: string | undefined,
  now: number,
): void {
  if (!sessionId || eventSessionId(event) !== sessionId) return;
  // Past the session filter, so this stream really does carry our events: from
  // here the idle rule is trustworthy. Before it, silence proves nothing.
  state.armed = true;
  state.lastActivity = now;

  const ev = event as { type?: string; properties?: { part?: Record<string, unknown> } };
  if (ev.type !== "message.part.updated") return;
  const part = ev.properties?.part as
    | {
        type?: string;
        callID?: string;
        tool?: string;
        state?: { status?: string; input?: unknown };
      }
    | undefined;
  if (part?.type !== "tool" || !part.callID || !part.tool) return;

  const status = part.state?.status;
  if (status === "running") {
    // `running` is the first state carrying the resolved arguments (`pending`
    // arrives with an empty input while the model is still streaming them), so
    // that is where we snapshot the command. Guard on has() because opencode
    // re-publishes `running` on every output chunk of a bash command.
    if (state.inFlight.has(part.callID)) return;
    const input = summarizeInput(part.state?.input);
    state.inFlight.set(part.callID, { tool: part.tool, input, startedAt: now });
    state.lastTool = part.tool;
    log.info("tool call started", { session: sessionId, tool: part.tool, input });
    return;
  }
  if (status === "completed" || status === "error") {
    const call = state.inFlight.get(part.callID);
    state.inFlight.delete(part.callID);
    log.info("tool call finished", {
      session: sessionId,
      tool: part.tool,
      status,
      durationMs: call ? now - call.startedAt : undefined,
      input: call?.input ?? summarizeInput(part.state?.input),
    });
  }
}

const secs = (ms: number): number => Math.round(ms / 1000);

/** The oldest in-flight tool call — the one most likely to be the wedge. */
export function stalledTool(state: ActivityState): InFlightTool | undefined {
  let oldest: InFlightTool | undefined;
  for (const call of state.inFlight.values()) {
    if (!oldest || call.startedAt < oldest.startedAt) oldest = call;
  }
  return oldest;
}

/**
 * Decide whether to kill the run. Returns null to keep waiting, or a diagnostic
 * message — it lands in the reviews table's `error` column and on the
 * dashboard, so it names which rule fired and what was in flight.
 */
export function watchdogVerdict(
  state: ActivityState,
  now: number,
  idleMs: number,
  ceilingMs: number,
): string | null {
  const idleFor = now - state.lastActivity;
  if (state.armed && idleFor > idleMs) {
    const stalled = stalledTool(state);
    const detail = stalled
      ? `in-flight tool ${stalled.tool} running ${secs(now - stalled.startedAt)}s: ${stalled.input}`
      : state.lastTool
        ? `no tool in flight, last tool: ${state.lastTool}`
        : "no tool calls seen";
    return `no activity for ${secs(idleFor)}s (${detail})`;
  }
  if (now - state.startedAt > ceilingMs) return `exceeded absolute ceiling of ${secs(ceilingMs)}s`;
  return null;
}
