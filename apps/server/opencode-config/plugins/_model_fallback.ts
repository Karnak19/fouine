// The logic behind plugins/model-fallback.ts (#185), split out so the tests can
// drive it without running inside opencode (same `_`-prefixed split as
// _commandcode.ts). opencode skips this file: it has no plugin default export.
//
// Adapted from opencode-fallback-model 0.1.0 by vimtor (MIT,
// https://www.npmjs.com/package/opencode-fallback-model): hook the session's
// retry decision, switch the session to the next model, and ask for an
// immediate retry. What fouine changes:
//  - the chain comes from a file fouine writes, one chain per session, re-read
//    every time the hook fires (a dashboard change applies at the next failure,
//    and each repo keeps its own list on the shared server);
//  - only rate-limit and quota errors switch models. The retry hook fires for
//    every failed step, auth errors and bad requests included, and switching
//    there would hide a real problem behind another model;
//  - a quota or plan cap switches at once, but a plain rate limit only once it
//    looks lasting (see shouldSwitch): a short 429 burst is left to opencode's
//    own backoff instead of moving the run off its main model for good.
//
// How it works in opencode 2.4.2 (packages/core/src/session/runner/retry.ts):
// the hook gets `{ sessionID, agent, model, error, attempt, decision }` and may
// replace `decision`. It is called for errors opencode would not retry too
// (a quota error arrives with `decision: { retry: false }`). With
// `{ retry: true, delay: 0 }` the same step runs again at once, and the step
// resolves the session's model again, so after `session.switchModel` it runs on
// the new model and stays on it for the rest of the session. Each retry uses
// one of opencode's 10 retries per step, the switches and the rate-limit
// retries the plugin lets opencode run on the current model alike, so a step
// gets about 9 fallbacks at most, fewer when a rate limit was waited out first.

export interface ModelRef {
  providerID: string;
  id: string;
}

// The slice of opencode's retry event we read and write (SessionRetry in
// @opencode/plugin). Structural so the tests can build one by hand.
export interface RetryEvent {
  readonly sessionID: string;
  readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string };
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly status?: number;
    // The provider's retry-after, when it sent one (Session.StructuredError).
    readonly retryAfterMs?: number;
  };
  readonly attempt: number;
  decision: { retry: false } | { retry: true; delay: number };
}

export interface AvailableModel {
  readonly providerID: string;
  readonly id: string;
  readonly enabled: boolean;
}

// What the plugin needs from opencode, as plain functions. The entry file adapts
// the real plugin context to this; the tests pass fakes.
export interface FallbackHost {
  onRetry(callback: (event: RetryEvent) => Promise<void>): Promise<unknown>;
  switchModel(sessionID: string, model: ModelRef): Promise<void>;
  // The parent session of a subagent session, or undefined for a top-level one.
  parentOf(sessionID: string): Promise<string | undefined>;
  listModels(): Promise<readonly AvailableModel[]>;
  log(message: string, data: Record<string, unknown>, level?: "info" | "warn"): void;
}

// What fouine writes (apps/server/src/review/fallback.ts): one chain of
// "provider/model" specs per live session.
export interface FallbackFile {
  sessions: Record<string, string[]>;
}

// Returns the file's content, or undefined when it is missing or unreadable.
export type FallbackReader = () => FallbackFile | undefined;

// Rate-limit and quota errors, the only ones worth another model: the exact
// limit types the opencode 2.4.2 binary emits. An explicit list rather than a
// `provider.*-limit` pattern, so a future type such as a context or output
// limit (which another model would not fix any better) never switches.
// Everything else — auth, invalid request, content filter, timeouts — is left
// to opencode. Shared with fouine's own run assessment (review/opencode.ts
// assessTurnOutcome), so the two sides agree on what a limit error is.
export const RATE_LIMIT_ERROR = "provider.rate-limit";
export const LIMIT_ERROR_TYPES: ReadonlySet<string> = new Set([
  RATE_LIMIT_ERROR,
  "provider.quota",
  "provider.budget-limit",
  "provider.model-budget-limit",
  "provider.free-limit",
  "provider.go-limit",
  "provider.chatgpt-limit",
  "provider.chatgpt-workspace-limit",
]);

export function isLimitError(type: string): boolean {
  return LIMIT_ERROR_TYPES.has(type);
}

// A plain rate limit is usually a burst that clears in seconds, and opencode
// already backs off for it (2s, 4s, 8s, then 10s gaps). Switching on the first
// 429 would move the run off its main model for the rest of the session over
// a hiccup, so a rate limit switches only when it looks lasting:
//  - opencode is giving up on it (`decision.retry` false);
//  - the wait is long: the provider's retry-after, or opencode's own delay
//    (which already honours retry-after), is over a minute;
//  - or it keeps failing: the current model has hit the limit twice in a row.
//    opencode numbers `attempt` per step (2 on the first retry) and keeps
//    counting across a switch, so "twice" is counted from the attempt the
//    plugin last switched at, not from 1: a fallback reached at attempt 3
//    gets the same patience as the main model (`since`).
// Every other limit type (quota, budget and plan caps) will not clear by
// waiting, so it switches at once.
export const RATE_LIMIT_LONG_WAIT_MS = 60_000;
export const RATE_LIMIT_SWITCH_FAILURES = 2;

// `since` is the attempt the current model started at within this step: 1, or
// the attempt of the plugin's last switch in this step.
export function shouldSwitch(
  event: Pick<RetryEvent, "error" | "attempt" | "decision">,
  since = 1,
): boolean {
  if (!isLimitError(event.error.type)) return false;
  if (event.error.type !== RATE_LIMIT_ERROR) return true;
  if (!event.decision.retry) return true;
  if (event.decision.delay > RATE_LIMIT_LONG_WAIT_MS) return true;
  if ((event.error.retryAfterMs ?? 0) > RATE_LIMIT_LONG_WAIT_MS) return true;
  return event.attempt - since >= RATE_LIMIT_SWITCH_FAILURES;
}

// "provider/model", split on the first slash only: model ids may contain
// slashes themselves (openrouter/deepseek/deepseek-v4-flash).
export function parseSpec(spec: string): ModelRef | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { providerID: spec.slice(0, slash), id: spec.slice(slash + 1) };
}

const same = (a: ModelRef, b: ModelRef) => a.providerID === b.providerID && a.id === b.id;
const format = (ref: ModelRef) => `${ref.providerID}/${ref.id}`;

export function parseFallbackFile(raw: string): FallbackFile | undefined {
  try {
    const parsed = JSON.parse(raw) as { sessions?: unknown };
    if (!parsed || typeof parsed.sessions !== "object" || parsed.sessions === null) return undefined;
    const sessions: Record<string, string[]> = {};
    for (const [id, chain] of Object.entries(parsed.sessions)) {
      if (Array.isArray(chain)) sessions[id] = chain.filter((s) => typeof s === "string");
    }
    return { sessions };
  } catch {
    return undefined;
  }
}

// Subagents run in child sessions fouine never sees, so a session with no chain
// of its own borrows its closest ancestor's. Bounded, in case of a cycle.
const MAX_PARENT_HOPS = 5;

async function chainFor(
  host: FallbackHost,
  file: FallbackFile,
  sessionID: string,
): Promise<string[] | undefined> {
  let current: string | undefined = sessionID;
  for (let hop = 0; current && hop <= MAX_PARENT_HOPS; hop++) {
    const chain = file.sessions[current];
    if (chain) return chain;
    current = await host.parentOf(current).catch(() => undefined);
  }
  return undefined;
}

// Errors that mean a model is unusable rather than busy: a missing or wrong key
// (provider.auth) or a model opencode can't route to (provider.no-route,
// "Model unavailable", the 2.4.2 type for an unknown or unregistered model).
// They move on to the next fallback only when the failing model is one the
// plugin switched to: a misconfigured fallback must not end a run that later
// fallbacks could finish. The run's own model never gets this — a bad main key
// has to surface as a bad key, not be papered over by another model.
export const BROKEN_FALLBACK_ERROR_TYPES: ReadonlySet<string> = new Set([
  "provider.auth",
  "provider.no-route",
]);

// The next model to try: the first one in the chain this session has not
// tried yet, so each fallback is tried at most once. `tried` holds every model
// that already failed in this session and every model the plugin switched it
// to. Walking forward from the failed model's index would be wrong when the
// run's own model is also in the chain (a repo whose main model is a global
// fallback): it would skip every entry above it and give up while those were
// still untouched. Models opencode does not list as enabled are skipped.
export function nextModel(
  chain: readonly ModelRef[],
  failed: ModelRef,
  available: readonly AvailableModel[] | undefined,
  tried: ReadonlySet<string> = new Set(),
): ModelRef | undefined {
  return chain.find(
    (ref) =>
      !same(ref, failed) &&
      !tried.has(format(ref)) &&
      (available === undefined ||
        available.some((m) => m.enabled && m.providerID === ref.providerID && m.id === ref.id)),
  );
}

// Per-session memory: the models already tried (failed, or switched to), the
// ones the plugin switched to, and the attempt of its last switch. In memory,
// so an opencode restart forgets it; the worst that does is retry a fallback
// once more, and opencode's 10-retries-per-step cap still bounds it.
// ponytail: no session-end hook to clean up on, so the map is capped at 500 and
// evicts the least recently used session (each access moves a session to the
// back), so a long-running live session keeps its record; a real
// session.deleted listener would replace this.
const MAX_TRACKED_SESSIONS = 500;

interface SessionState {
  readonly tried: Set<string>;
  readonly switchedTo: Set<string>;
  lastSwitchAttempt?: number;
}

export async function setupModelFallback(host: FallbackHost, read: FallbackReader): Promise<void> {
  const sessions = new Map<string, SessionState>();
  const stateFor = (sessionID: string): SessionState => {
    let state = sessions.get(sessionID);
    if (state) {
      sessions.delete(sessionID);
    } else {
      state = { tried: new Set(), switchedTo: new Set() };
    }
    sessions.set(sessionID, state);
    if (sessions.size > MAX_TRACKED_SESSIONS) {
      sessions.delete(sessions.keys().next().value!);
    }
    return state;
  };

  await host.onRetry(async (event) => {
    const failed = { providerID: String(event.model.providerID), id: String(event.model.id) };
    const failedSpec = format(failed);
    // Only peek here: most retries are not ours to handle, and they shouldn't
    // create or refresh a session's record.
    const known = sessions.get(event.sessionID);
    // A lower attempt than the last switch means opencode is on a new step,
    // which counts from 1 again.
    const last = known?.lastSwitchAttempt;
    const since = last !== undefined && event.attempt > last ? last : 1;
    const brokenFallback =
      BROKEN_FALLBACK_ERROR_TYPES.has(event.error.type) &&
      known?.switchedTo.has(failedSpec) === true;
    if (!brokenFallback && !shouldSwitch(event, since)) return;
    const file = read();
    if (!file) return;
    const specs = await chainFor(host, file, event.sessionID);
    if (!specs || specs.length === 0) return;
    const chain = specs.flatMap((spec) => parseSpec(spec) ?? []);

    // A failed listing doesn't block the switch: better to try the next model
    // than to give up on the review.
    let available: readonly AvailableModel[] | undefined;
    try {
      available = await host.listModels();
    } catch {
      available = undefined;
    }

    const state = stateFor(event.sessionID);
    const tried = state.tried;
    tried.add(failedSpec);
    if (brokenFallback) {
      // Loud on purpose: this is a configuration problem (a fallback without
      // its provider's key, a model that isn't registered) someone should fix.
      host.log(
        "fallback model is unusable, moving on",
        {
          session: event.sessionID,
          model: failedSpec,
          error: event.error.type,
          detail: event.error.message,
          status: event.error.status,
        },
        "warn",
      );
    }
    const next = nextModel(chain, failed, available, tried);
    // Chain exhausted: leave opencode's own decision alone.
    if (!next) {
      host.log("fallback chain exhausted", {
        session: event.sessionID,
        failed: failedSpec,
        error: event.error.type,
      });
      return;
    }

    try {
      await host.switchModel(event.sessionID, next);
    } catch (cause) {
      host.log("fallback switch failed", {
        session: event.sessionID,
        to: format(next),
        cause: String(cause),
      });
      return;
    }
    tried.add(format(next));
    state.switchedTo.add(format(next));
    state.lastSwitchAttempt = event.attempt;
    event.decision = { retry: true, delay: 0 };
    host.log("switched to fallback model", {
      session: event.sessionID,
      from: failedSpec,
      to: format(next),
      error: event.error.type,
      detail: event.error.message,
      attempt: event.attempt,
    });
  });
}
