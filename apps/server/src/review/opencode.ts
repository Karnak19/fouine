import { ClientError, OpenCode } from "@opencode/client";
import type { PermissionRuleset } from "@opencode/client";
import { resolveDefaultModel } from "~/settings";
import { COMMANDCODE_PROVIDER, toConfigKey } from "~/review/commandcode";
import { log } from "~/server/log";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { config } from "~/config";
import { internalBaseUrl } from "~/server/internal";

// opencode v2 client/server plumbing for the single long-lived server fouine now
// runs: ONE `opencode serve` for the process lifetime hosts one session per
// review. The manager that owns that child lives in effect/opencode.ts; this
// module only holds the spawn helpers and the pure session/watchdog folds.
//
// v2 notes baked in here:
//  - The server requires HTTP Basic auth with a password. We set it ourselves
//    via OPENCODE_SERVER_PASSWORD so we don't have to parse it out of the
//    child's stdout (the default is random and only printed there).
//  - Per-review permissions ride `session.create({ permissions })`. The child
//    no longer receives OPENCODE_CONFIG_CONTENT, and — crucially — never sees
//    fouine's app secrets: `spawnOpencode` hands it a minimal env allowlist
//    (PATH, HOME, OPENCODE_CONFIG_DIR, OPENCODE_SERVER_PASSWORD,
//    FOUINE_INTERNAL_URL), not a spread of process.env. The old spread leaked
//    fouine's GitHub token and app config into the model's bash.
//  - Per-review GitHub/tool context now lives server-side (the loopback proxy
//    lane) rather than in the child's env, so concurrent reviews no longer need
//    per-spawn isolation (#23 is structurally impossible now).
//  - session.create carries model/agent/location; session.prompt({sessionID,
//    text}) only admits the message; session.wait blocks until the run goes idle.

export type OpencodeClient = ReturnType<typeof OpenCode.make>;

// ponytail: grab an ephemeral port so a second fouine process (or a stale child
// that never exited) doesn't collide with the singleton. Tiny TOCTOU window
// between close and bind; the rare loser fails to start and the manager's next
// acquire retries.
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

export function parseModel(spec: string): { providerID: string; modelID: string } {
  // First slash only: a provider's model ids may contain a slash themselves
  // (an org-prefixed id like `openrouter/deepseek/deepseek-v4-flash`), and the
  // rest of the spec must reach opencode untouched.
  const cut = spec.indexOf("/");
  const providerID = cut === -1 ? "" : spec.slice(0, cut);
  const modelID = cut === -1 ? "" : spec.slice(cut + 1);
  if (!providerID || !modelID) {
    throw new Error(`Invalid model spec "${spec}", expected "provider/model"`);
  }
  // Command Code specs briefly used the upstream org-prefixed id
  // (`commandcode/deepseek/deepseek-v4-flash`) before the plugin catalog
  // flattened keys to `deepseek-v4-flash`. Normalise so a spec stored under the
  // old shape keeps resolving instead of failing at spawn.
  if (providerID === COMMANDCODE_PROVIDER) return { providerID, modelID: toConfigKey(modelID) };
  return { providerID, modelID };
}

export interface OpencodeServe {
  client: OpencodeClient;
  port: number;
  kill: () => void;
}

// Basic auth is the only auth v2 servers accept: `opencode:<password>`.
export function authHeaders(password: string): Record<string, string> {
  return { authorization: `Basic ${btoa(`opencode:${password}`)}` };
}

async function waitForReady(port: number, password: string, proc: Bun.Subprocess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`opencode serve exited during startup (code ${proc.exitCode})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/info`, { headers: authHeaders(password) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`opencode serve did not become ready within ${timeoutMs}ms`);
}

// The ONLY parent environment the opencode child may inherit. Everything else
// (GitHub token, internal secret, app config, …) is fouine's and must never
// reach the model's bash. Pure so the allowlist is directly testable.
//
// PASSTHROUGH_ENV carries the few *non-secret* knobs the opencode-side config
// and plugins read at runtime. It stays tiny on purpose: credentials are
// excluded even when optional — POSTHOG_API_KEY (a key the model could
// exfiltrate) is deliberately NOT here.
const PASSTHROUGH_ENV = ["OPENCODE_BASH_TIMEOUT_MAX_MS"] as const;

export function opencodeSpawnEnv(
  password: string,
  configDir: string,
  internalUrl: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_SERVER_PASSWORD: password,
    FOUINE_INTERNAL_URL: internalUrl,
  };
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface SpawnOpencodeOptions {
  port: number;
  signal?: AbortSignal;
  // The fouine-owned seeded config dir (agent + tools + skills). Defaults to the
  // runtime dir boot seeded.
  configDir?: string;
  // Loopback base URL the model's tools call back on.
  internalUrl?: string;
}

// Spawn one `opencode serve` + its client with the minimal env. The caller owns
// the child: kill() on teardown. This is called once per process by the manager
// (effect/opencode.ts), never per review.
export async function spawnOpencode(opts: SpawnOpencodeOptions): Promise<OpencodeServe> {
  const port = opts.port;
  const password = randomBytes(24).toString("hex");
  const env = opencodeSpawnEnv(
    password,
    opts.configDir ?? config.opencode.runtimeDir,
    opts.internalUrl ?? internalBaseUrl,
  );
  const proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    env,
    stdout: "ignore",
    stderr: "ignore",
    // A wedged child must not keep the fouine process alive on its behalf.
    stdin: "ignore",
  });
  try {
    await waitForReady(port, password, proc);
  } catch (cause) {
    try {
      proc.kill();
    } catch {
      // already dead
    }
    throw cause;
  }
  const client = OpenCode.make({
    baseUrl: `http://127.0.0.1:${port}`,
    headers: authHeaders(password),
  });
  const onAbort = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    client,
    port,
    kill: () => {
      opts.signal?.removeEventListener("abort", onAbort);
      onAbort();
    },
  };
}

// Dashboard helper: run `fn` against the singleton server's client. No longer
// spawns per call — the manager owns the one child for the process lifetime.
// The dynamic import keeps this module free of a static cycle with the manager.
export async function withOpencode<T>(fn: (client: OpencodeClient) => Promise<T>): Promise<T> {
  const { openCodeManager } = await import("~/effect/opencode");
  const serve = await openCodeManager.acquire();
  return fn(serve.client);
}

export interface RunOptions {
  directory: string;
  prompt: string;
  model?: string;
  agent?: string;
  // Per-session permission ruleset, delivered to `session.create`. The manager
  // derives this from `denyTestCommands` when a caller doesn't supply one.
  permissions?: PermissionRuleset;
  // Returns true once the agent has actually posted (a findings row exists for
  // this review). Checked after the session ends: if the agent wrapped up
  // without calling post_review, the same session is continued with one nudge
  // message instead of silently completing with nothing on the PR.
  hasPosted?: () => boolean;
  // Returns true once the manager's teardown has run (abort/supersede/watchdog
  // kill). Teardown cannot cancel this promise, and session.interrupt only stops
  // a run already in flight, so ask() consults this before every prompt.
  isTornDown?: () => boolean;
  // Where to publish live transcript deltas. Optional: without it the demux
  // still feeds the watchdog and simply broadcasts nothing, which is what any
  // caller that has no review row to attach the transcript to should do.
  transcript?: { reviewId: number; repo: string };
  // Deny the agent test/lint/build/typecheck commands for this run (global
  // setting, overridable per repo). Translated into `permissions` by the
  // manager via reviewOpencodeConfig in review/permissions.
  denyTestCommands?: boolean;
}

export interface RunHooks {
  // Fired once the session exists, before the first prompt — the manager
  // registers its demux sink here.
  onSession?: (id: string) => Promise<void> | void;
}

export interface RunResult {
  sessionId: string;
  text: string;
  cost: number;
  tokens: number;
}

// Assistant text/cost/tokens for the whole session. v2 messages are flat rows;
// text lives in `content` parts, accounting per message.
function summarizeMessages(msgs: Awaited<ReturnType<OpencodeClient["message"]["list"]>>["data"]) {
  let cost = 0;
  let tokens = 0;
  const texts: string[] = [];
  for (const m of msgs) {
    if (m.type !== "assistant") continue;
    cost += m.cost ?? 0;
    const t = m.tokens;
    if (t) tokens += t.input + t.output + t.reasoning;
    for (const c of m.content) {
      if (c.type === "text" && c.text) texts.push(c.text);
    }
  }
  return { cost, tokens, text: texts.join("\n") };
}

// The v2 client does no retries by contract ("callers own transport selection,
// recording, tracing, retries"), so one dropped keep-alive socket loses a whole
// review — the production incident where `session.wait` died with
// `ClientError: Transport ← TimeoutError` and the retry then died in
// `session.create` with a closed socket. We re-issue only the calls that are
// safe to repeat, bounded, and never once teardown has run.
const TRANSPORT_RETRY_ATTEMPTS = 3; // 1 initial + 2 retries
const TRANSPORT_RETRY_BACKOFF_MS = 250; // 250ms, then 500ms

// The class the client's promise API throws when the HTTP exchange itself fails.
// `reason` separates a transport failure from a real answer (UnexpectedStatus) or
// a protocol problem (MalformedResponse / SseEventTooLarge).
function isTransportError(err: unknown): boolean {
  return err instanceof ClientError && err.reason === "Transport";
}

async function withTransportRetry<T>(
  call: string,
  fn: () => Promise<T>,
  isTornDown?: () => boolean,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; ; attempt++) {
    // Before every attempt (including the first retry): a torn-down run must
    // never re-issue a request. The watchdog can win its race while the call is
    // in flight — it interrupts the Effect but does NOT cancel this promise.
    if (isTornDown?.()) throw lastErr ?? new Error(`${call}: run torn down`);
    try {
      return await fn();
    } catch (err) {
      // Never retry UnexpectedStatus (a 4xx/5xx is a real answer) or anything
      // that isn't a client transport failure.
      if (!isTransportError(err) || attempt >= TRANSPORT_RETRY_ATTEMPTS) throw err;
      lastErr = err;
      if (isTornDown?.()) throw err;
      log.warn("opencode transport error, retrying", {
        call,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, TRANSPORT_RETRY_BACKOFF_MS * attempt));
    }
  }
}

export async function runReview(
  client: OpencodeClient,
  opts: RunOptions,
  hooks: RunHooks = {},
): Promise<RunResult> {
  const model = parseModel(opts.model ?? resolveDefaultModel());

  // create re-issues to get a fresh session. ponytail: an orphan session from a
  // lost response is idle, never prompted, and harmless — not worth chasing.
  const session = await withTransportRetry(
    "session.create",
    () =>
      client.session.create({
        title: "fouine review",
        ...(opts.agent ? { agent: opts.agent } : {}),
        model: { providerID: model.providerID, id: model.modelID },
        location: { directory: opts.directory },
        ...(opts.permissions ? { permissions: opts.permissions } : {}),
      }),
    opts.isTornDown,
  );

  if (hooks.onSession) await hooks.onSession(session.id);

  // prompt() only admits the message; wait() blocks until the run goes idle.
  // Both together are the v1 blocking session.prompt().
  const ask = async (text: string) => {
    // Teardown (abort/supersede/watchdog) does not cancel this promise, and
    // session.interrupt only stops a run already in flight. Without this guard a
    // torn-down run keeps prompting: the create-window interrupt is a no-op on an
    // idle session, and after a mid-run interrupt wait() settles and the nudge
    // below would start a fresh, unsupervised run.
    if (opts.isTornDown?.()) return;
    // prompt is deliberately NOT retried: a lost prompt response re-issued on
    // the same session would start a second run — the same double-run class the
    // guard above closed.
    await client.session.prompt({ sessionID: session.id, text });
    // wait is a plain long-blocking POST that returns when the session goes
    // idle, so re-issuing it simply waits again — safe, and the fix for the
    // timed-out-wait case.
    await withTransportRetry(
      "session.wait",
      () => client.session.wait({ sessionID: session.id }),
      opts.isTornDown,
    );
  };

  await ask(opts.prompt);

  // Some sessions end without the agent ever calling post_review — the PR gets
  // no review and no comments. Continue the same session (full context intact)
  // with one nudge. ponytail: one nudge, no retry loop — a model that ignores a
  // direct instruction twice won't do better on a third.
  if (opts.hasPosted && !opts.hasPosted()) {
    await ask(
      "You ended the session without posting the review to GitHub. Post it now with the " +
        "post_review tool (summary + your inline findings). If you found nothing to flag, " +
        "post a short summary-only review — pick `event` by the severity rule in your " +
        "instructions, don't default to COMMENT. If you already posted it, just say so.",
    );
  }

  // ponytail: no pagination — one review's assistant messages sit well under a
  // page. If reviews ever grow past the default limit, follow the cursor here.
  const msgs = (
    await withTransportRetry(
      "message.list",
      () => client.message.list({ sessionID: session.id }),
      opts.isTornDown,
    )
  ).data;
  const { cost, tokens, text } = summarizeMessages(msgs);

  return { sessionId: session.id, text, cost, tokens };
}

// ─── idle watchdog ──────────────────────────────────────────────────────────
//
// A review that never returns is one of two things, and they need opposite
// treatment: it is either *legitimately long* (big diff, hundreds of tool
// calls) or *wedged* (opencode stops making progress mid tool call and the
// blocking wait never resolves). A flat wall-clock ceiling cannot tell them
// apart, so every value is wrong twice: too short for the first and far too
// long for the second. #64 raised it 10 → 30 min and reviews still died
// having burned $0.002 of model spend across the whole 1800s window — i.e. the
// model had stopped thinking almost immediately and we waited half an hour.
//
// So the primary rule is *idleness*, not elapsed time: no event for this
// session within idleTimeoutMs means wedged, kill it now. Elapsed time stays
// only as an absolute backstop for the pathological case (something spewing
// events forever without ever finishing).
//
// The heartbeat is opencode's SSE event stream (`client.event.subscribe()`),
// now fanned out to every live session by the manager's single pump. v2 events
// are typed envelopes: `{ type, data: { sessionID, ... } }`. Tool lifecycle
// rides `session.message.content.updated`, which re-publishes the WHOLE content
// array of a message on every change — each tool part carrying `state.status`
// walking streaming → running → completed | error.
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
  // silent model. opencode routes `/event` per location, so subscribing to the
  // wrong instance's stream yields events that never match. `lastActivity`
  // then never advances and every review is killed at exactly idleTimeoutMs,
  // mid-work, reported as "no tool calls seen". Arming on first match makes
  // that failure degrade to the absolute ceiling (the old wall-clock
  // behaviour) instead of killing.
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
  if (typeof input === "string") {
    return input.length > MAX_INPUT ? `${input.slice(0, MAX_INPUT)}…` : input;
  }
  const json = (() => {
    try {
      return JSON.stringify(input) ?? "";
    } catch {
      return "<unserializable>";
    }
  })();
  return json.length > MAX_INPUT ? `${json.slice(0, MAX_INPUT)}…` : json;
}

// v2 events carry their session id at `data.sessionID`.
export function eventSessionId(event: unknown): string | undefined {
  const data = (event as { data?: { sessionID?: unknown } } | null)?.data;
  return typeof data?.sessionID === "string" ? data.sessionID : undefined;
}

/** The subset of a v2 content part the watchdog fold needs. */
interface ToolPartLike {
  type?: string;
  id?: string;
  name?: string;
  state?: { status?: string; input?: unknown };
}

/**
 * Fold one SSE event into the activity state. Events for other sessions (or
 * server-wide ones) are ignored so an unrelated concurrent review can't keep a
 * wedged one alive.
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

  const ev = event as { type?: string; data?: { content?: ToolPartLike[] } };
  if (ev.type !== "session.message.content.updated") return;
  for (const part of ev.data?.content ?? []) {
    if (part.type !== "tool" || !part.id) continue;

    const status = part.state?.status;
    if (status === "running") {
      // `running` is the first state carrying the resolved arguments
      // (`streaming` arrives with the raw input string while the model is
      // still emitting them), so that is where we snapshot the command.
      // Guard on has() because opencode re-publishes `running` on every
      // output chunk of a bash command.
      if (state.inFlight.has(part.id)) continue;
      const input = summarizeInput(part.state?.input);
      const tool = part.name ?? "unknown";
      state.inFlight.set(part.id, { tool, input, startedAt: now });
      state.lastTool = tool;
      log.info("tool call started", { session: sessionId, tool, input });
      continue;
    }
    if (status === "completed" || status === "error") {
      const call = state.inFlight.get(part.id);
      state.inFlight.delete(part.id);
      log.info("tool call finished", {
        session: sessionId,
        tool: part.name ?? "unknown",
        status,
        durationMs: call ? now - call.startedAt : undefined,
        input: call?.input ?? summarizeInput(part.state?.input),
      });
    }
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
