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
//    there would hide a real problem behind another model.
//
// How it works in opencode 2.4.2 (packages/core/src/session/runner/retry.ts):
// the hook gets `{ sessionID, agent, model, error, attempt, decision }` and may
// replace `decision`. It is called for errors opencode would not retry too
// (a quota error arrives with `decision: { retry: false }`). With
// `{ retry: true, delay: 0 }` the same step runs again at once, and the step
// resolves the session's model again, so after `session.switchModel` it runs on
// the new model and stays on it for the rest of the session. Each switch uses
// one of opencode's 10 retries per step, so about 9 fallbacks at most.

export interface ModelRef {
  providerID: string;
  id: string;
}

// The slice of opencode's retry event we read and write (SessionRetry in
// @opencode/plugin). Structural so the tests can build one by hand.
export interface RetryEvent {
  readonly sessionID: string;
  readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string };
  readonly error: { readonly type: string; readonly message: string; readonly status?: number };
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
  log(message: string, data: Record<string, unknown>): void;
}

// What fouine writes (apps/server/src/review/fallback.ts): one chain of
// "provider/model" specs per live session.
export interface FallbackFile {
  sessions: Record<string, string[]>;
}

// Returns the file's content, or undefined when it is missing or unreadable.
export type FallbackReader = () => FallbackFile | undefined;

// Rate-limit and quota errors, the only ones worth another model. opencode
// 2.4.2 names them `provider.rate-limit` and `provider.quota`, plus a family of
// `provider.*-limit` types for spend and plan caps (budget-limit, free-limit,
// go-limit, …). Everything else — auth, invalid request, content filter,
// timeouts — is left to opencode.
export function isLimitError(type: string): boolean {
  return type === "provider.quota" || /^provider\.[a-z-]*-limit$/.test(type);
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

// The next model to try: walk forward from the failed model's place in the
// chain, so each fallback is tried at most once. When the failed model is not
// in the chain (it is the run's own model), start from the top. Models opencode
// does not list as enabled are skipped.
export function nextModel(
  chain: readonly ModelRef[],
  failed: ModelRef,
  available: readonly AvailableModel[] | undefined,
): ModelRef | undefined {
  const index = chain.findIndex((ref) => same(ref, failed));
  return chain
    .slice(index + 1)
    .find(
      (ref) =>
        !same(ref, failed) &&
        (available === undefined ||
          available.some((m) => m.enabled && m.providerID === ref.providerID && m.id === ref.id)),
    );
}

export async function setupModelFallback(host: FallbackHost, read: FallbackReader): Promise<void> {
  await host.onRetry(async (event) => {
    if (!isLimitError(event.error.type)) return;
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

    const failed = { providerID: String(event.model.providerID), id: String(event.model.id) };
    const next = nextModel(chain, failed, available);
    // Chain exhausted: leave opencode's own decision alone.
    if (!next) {
      host.log("fallback chain exhausted", {
        session: event.sessionID,
        failed: format(failed),
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
    event.decision = { retry: true, delay: 0 };
    host.log("switched to fallback model", {
      session: event.sessionID,
      from: format(failed),
      to: format(next),
      error: event.error.type,
      detail: event.error.message,
      attempt: event.attempt,
    });
  });
}
