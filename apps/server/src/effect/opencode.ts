import { Effect } from "effect";
import { OpenCode } from "@opencode/client";
import type { PermissionRuleset } from "@opencode/client";
import { resolveApiKey, resolveDefaultModel, ZAI_PROVIDER } from "~/settings";
import { config } from "~/config";
import {
  authHeaders,
  eventSessionId,
  freePort,
  newActivityState,
  observeEvent,
  parseModel,
  runReview,
  spawnOpencode,
  stalledTool,
  watchdogVerdict,
  type ActivityState,
  type OpencodeServe,
  type RunOptions,
  type RunResult,
} from "~/review/opencode";
import {
  createTranscriptStream,
  type TranscriptDelta,
  type TranscriptStream,
} from "~/review/transcript";
import { reviewOpencodeConfig } from "~/review/permissions";
import { OpenCodeError } from "~/effect/errors";
import { publishTranscript } from "~/server/events";
import { log } from "~/server/log";

// How often the watchdog re-evaluates. Cheap (one Date.now() compare), and the
// resolution only needs to be coarse relative to the minute-scale timeouts.
const WATCHDOG_TICK_MS = 5_000;

// How long a lost event stream may stay down before we call the server gone and
// fail the reviews that were riding it. Long enough to ride out a restart, short
// enough that a dead server doesn't strand rows until their timeout.
const SERVER_LOSS_GRACE_MS = 15_000;
const SERVER_LOSS_POLL_MS = 1_000;

// ─── singleton manager ───────────────────────────────────────────────────────
//
// One `opencode serve` for the whole process, one session per review. The old
// design spawned a child per review (and leaked process.env into it); this
// manager owns the single child, its one SSE pump, and the provider keys.
//
// Two modes:
//  - child (default): fouine spawns the server itself via spawnOpencode, with a
//    minimal env allowlist (never its own secrets).
//  - sidecar: when OPENCODE_BASE_URL is set (the official image runs opencode as
//    a sidecar), fouine does not spawn anything and just talks to that URL,
//    authenticating with OPENCODE_SERVER_PASSWORD when present.

// A registered in-flight session: the watchdog fold, the transcript fold, where
// to publish its deltas, and how to fail it if the server disappears.
export interface ActivitySink {
  state: ActivityState;
  transcript: TranscriptStream;
  publish?: { reviewId: number; repo: string };
  onServerLost: (message: string) => void;
}

export interface ManagerDeps {
  spawnServe: () => Promise<OpencodeServe>;
  probe: (serve: OpencodeServe) => Promise<boolean>;
  // Injected so tests can exercise the push-once logic without real settings.
  resolveKey: (providerID: string) => string | undefined;
  now: () => number;
  serverLossGraceMs: number;
  serverLossPollMs: number;
}

// Sidecar mode: OPENCODE_BASE_URL set → talk to that server and spawn nothing
// (the official image runs opencode as a sidecar). Returns undefined in child
// mode. Pure so the branch is testable without a server.
export function makeSidecarServe(
  env: Record<string, string | undefined> = process.env,
): OpencodeServe | undefined {
  const baseUrl = env.OPENCODE_BASE_URL;
  if (!baseUrl) return undefined;
  const password = env.OPENCODE_SERVER_PASSWORD;
  return {
    client: OpenCode.make({
      baseUrl,
      ...(password ? { headers: authHeaders(password) } : {}),
    }),
    port: 0,
    kill: () => {},
  };
}

function defaultSpawnServe(): Promise<OpencodeServe> {
  const sidecar = makeSidecarServe();
  if (sidecar) return Promise.resolve(sidecar);
  return freePort().then((port) => spawnOpencode({ port }));
}

const defaultDeps: ManagerDeps = {
  spawnServe: defaultSpawnServe,
  probe: async (serve) => {
    try {
      await serve.client.server.info();
      return true;
    } catch {
      return false;
    }
  },
  resolveKey: (providerID) => resolveApiKey(providerID),
  now: () => Date.now(),
  serverLossGraceMs: SERVER_LOSS_GRACE_MS,
  serverLossPollMs: SERVER_LOSS_POLL_MS,
};

export class OpenCodeServerManager {
  private serve?: OpencodeServe;
  private starting?: Promise<OpencodeServe>;
  private pumpCtrl?: AbortController;
  private readonly sessions = new Map<string, ActivitySink>();
  private readonly pushedKeys = new Map<string, string>();
  private stopping = false;
  private readonly deps: ManagerDeps;

  constructor(deps: Partial<ManagerDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  get current(): OpencodeServe | undefined {
    return this.serve;
  }

  /** The singleton server, spawning or reconnecting on first use. */
  async acquire(): Promise<OpencodeServe> {
    if (this.serve) return this.serve;
    if (!this.starting) this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async start(): Promise<OpencodeServe> {
    const serve = await this.deps.spawnServe();
    this.serve = serve;
    this.stopping = false;
    this.pushedKeys.clear();
    // Start the pump before pushing keys: events can only arrive after a
    // session exists, but ordering it first means a slow integration call can
    // never swallow the first review's opening events.
    this.startPump(serve);
    await this.pushInitKeys();
    log.info("opencode server ready", { port: serve.port, sidecar: serve.port === 0 });
    return serve;
  }

  private startPump(serve: OpencodeServe): void {
    this.pumpCtrl?.abort();
    const ctrl = new AbortController();
    this.pumpCtrl = ctrl;
    // Fire-and-forget: a broken event stream must degrade the watchdog and the
    // transcript, never fail the manager. `finally` disarms every registered
    // state so a heartbeat that can no longer arrive never reads as silence.
    void (async () => {
      try {
        const sub = serve.client.event.subscribe({ signal: ctrl.signal });
        for await (const event of sub) {
          const id = eventSessionId(event);
          if (!id) continue; // server-wide event
          const sink = this.sessions.get(id);
          if (!sink) continue; // unknown session — dropped
          const now = this.deps.now();
          observeEvent(sink.state, event, id, now);
          this.publish(sink, event, now, id);
        }
      } catch (cause) {
        if (!ctrl.signal.aborted) {
          log.warn("opencode event stream lost, idle watchdog disabled", { cause: String(cause) });
        }
      } finally {
        for (const sink of this.sessions.values()) sink.state.armed = false;
        if (!ctrl.signal.aborted && this.serve === serve && !this.stopping) {
          await this.handleServerLoss(serve);
        }
      }
    })();
  }

  private publish(sink: ActivitySink, event: unknown, now: number, sessionId: string): void {
    const target = sink.publish;
    if (!target) return;
    let deltas: TranscriptDelta[];
    try {
      deltas = sink.transcript.observe(event, sessionId, now);
    } catch {
      // a malformed event is not the review's problem
      return;
    }
    for (const delta of deltas) {
      try {
        publishTranscript(target.reviewId, target.repo, delta);
      } catch {
        // a dead subscriber is not the review's problem either
      }
    }
  }

  // The stream died. Give the server a grace window to come back on the same
  // client; if it doesn't, fail every in-flight review and drop the serve so the
  // next acquire re-spawns/reconnects. The runner's single auto-retry picks them
  // up from there.
  private async handleServerLoss(serve: OpencodeServe): Promise<void> {
    const deadline = Date.now() + this.deps.serverLossGraceMs;
    // Always probe at least once: a genuine restart briefly refuses connections,
    // whereas a stream-only blip leaves a reachable server that we can re-pump.
    for (;;) {
      if (await this.deps.probe(serve)) {
        if (this.serve === serve && !this.stopping) {
          // Small backoff so a server that accepts connections but instantly
          // drops the stream can't spin this loop at full tilt.
          await new Promise((r) => setTimeout(r, this.deps.serverLossPollMs));
          if (this.serve === serve && !this.stopping) this.startPump(serve);
        }
        return;
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, this.deps.serverLossPollMs));
    }
    if (this.serve !== serve) return;
    this.serve = undefined;
    this.pushedKeys.clear();
    const sinks = [...this.sessions.values()];
    this.sessions.clear();
    if (sinks.length > 0) {
      log.error("opencode server lost; failing in-flight reviews", { count: sinks.length });
    }
    for (const sink of sinks) {
      try {
        sink.onServerLost("opencode server restarted");
      } catch {
        // a sink that can't be failed must not stop the others
      }
    }
  }

  register(sessionId: string, sink: ActivitySink): void {
    this.sessions.set(sessionId, sink);
  }

  deregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Push the keys we can resolve once, at init: the default model's provider,
  // plus Z.ai when configured. Later settings changes and per-run callers go
  // through ensureProviderKey(), which compares the *key* so a rotated dashboard
  // key reaches the live server and a per-repo model on a different provider
  // gets its key without re-pushing on every review. Never fatal: a failed key
  // push degrades auth, it must not fail the server startup that reviews depend
  // on.
  private async pushInitKeys(): Promise<void> {
    try {
      await this.ensureProviderKey(parseModel(resolveDefaultModel()).providerID);
    } catch (cause) {
      log.warn("could not push default provider key", { cause: String(cause) });
    }
    try {
      if (this.deps.resolveKey(ZAI_PROVIDER)) await this.ensureProviderKey(ZAI_PROVIDER);
    } catch (cause) {
      log.warn("could not push zai provider key", { cause: String(cause) });
    }
  }

  async ensureProviderKey(providerID: string): Promise<void> {
    const client = this.serve?.client;
    if (!client) return;
    const key = this.deps.resolveKey(providerID);
    // Compare the key, not just the provider: a rotated dashboard key must reach
    // the live server, not wait for a fouine restart (v1 re-pushed the current
    // key on every run).
    if (!key || this.pushedKeys.get(providerID) === key) return;
    // v1 stored these via client.auth.set; v2 folds provider credentials into
    // integrations. The integration id is the provider id.
    await client.integration.connect.key({ integrationID: providerID, key });
    this.pushedKeys.set(providerID, key);
  }

  /** Reload the server's config from disk. Used by the config-settings lane. */
  async locationReload(): Promise<void> {
    await this.serve?.client.location.reload();
  }

  /** Shutdown/test helper: drop the pump, kill the child, forget everything. */
  stop(): void {
    this.stopping = true;
    this.pumpCtrl?.abort();
    this.pumpCtrl = undefined;
    try {
      this.serve?.kill();
    } catch {
      // already dead
    }
    this.serve = undefined;
    this.sessions.clear();
    this.pushedKeys.clear();
  }
}

export const openCodeManager = new OpenCodeServerManager();

// The child now outlives any single review, so make sure fouine's exit takes it
// with us instead of orphaning an `opencode serve` on every restart. `exit` is
// synchronous, which is all kill() needs; a no-op when we never spawned.
process.on("exit", () => openCodeManager.stop());

// ─── Effect service ──────────────────────────────────────────────────────────
//
// One review = one session on the shared server. The service acquires the
// manager (spawning/reconnecting on first use), registers a demux sink for the
// session, races the run against the watchdog and against server loss, then
// interrupts the session and deregisters. It NEVER kills the server.
export class OpenCodeService extends Effect.Service<OpenCodeService>()("app/OpenCodeService", {
  sync: () => ({
    runReview: (
      opts: RunOptions,
      onSession: (id: string) => void,
      signal: AbortSignal,
    ): Effect.Effect<RunResult, OpenCodeError> => {
      // The session id only exists after runReview creates it, but the release
      // (which owns teardown) needs it, so it lives in this call's closure. Same
      // for the abort listener the release removes.
      let sessionId: string | undefined;
      let onAbort: (() => void) | undefined;
      return Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => openCodeManager.acquire(),
          catch: (cause) => new OpenCodeError({ op: "opencodeServer", cause }),
        }),
        (serve) => {
          const state = newActivityState(Date.now());
          const transcript = createTranscriptStream();

          // Resolved by the manager's server-loss handler; racing it means an
          // in-flight session.wait fails instead of hanging when the server
          // dies, and the runner's auto-retry takes over.
          let rejectServerLost: ((reason: unknown) => void) | undefined;
          const serverLost = new Promise<never>((_, reject) => {
            rejectServerLost = reject;
          });

          const sink: ActivitySink = {
            state,
            transcript,
            ...(opts.transcript ? { publish: opts.transcript } : {}),
            onServerLost: (message) => rejectServerLost?.(message),
          };

          // The caller's abort (dashboard Stop, /fouine stop, supersede) must
          // stop the run too. We can't kill the server any more, so racing an
          // abort rejection ends the Effect, and the release interrupts the
          // session. The caller's signal is only READ, never aborted.
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason ?? "AbortError");
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });

          const watchdog = Effect.async<never, OpenCodeError>((resume) => {
            const timer = setInterval(() => {
              const verdict = watchdogVerdict(
                state,
                Date.now(),
                config.review.idleTimeoutMs,
                config.review.timeoutMs,
              );
              if (!verdict) return;
              const stalled = stalledTool(state);
              log.error("review watchdog fired", {
                session: sessionId,
                verdict,
                tool: stalled?.tool,
                input: stalled?.input,
              });
              resume(Effect.fail(new OpenCodeError({ op: "runReview", cause: verdict })));
            }, WATCHDOG_TICK_MS);
            return Effect.sync(() => clearInterval(timer));
          });

          const permissions =
            opts.permissions ??
            (reviewOpencodeConfig(opts.denyTestCommands ?? false).permissions as PermissionRuleset);

          // v1 pushed the run's provider key before every session.create
          // (setProviderApiKey); restore that so a per-repo/per-pipeline model on
          // a different provider authenticates. Never fatal.
          const keyPush = openCodeManager
            .ensureProviderKey(parseModel(opts.model ?? resolveDefaultModel()).providerID)
            .catch(() => undefined);

          return Effect.tryPromise({
            try: () =>
              Promise.race([
                keyPush.then(() =>
                  runReview(
                    serve.client,
                    { ...opts, permissions },
                    {
                      onSession: (id) => {
                        sessionId = id;
                        openCodeManager.register(id, sink);
                        onSession(id);
                      },
                    },
                  ),
                ),
                serverLost,
                aborted,
              ]),
            catch: (cause) => new OpenCodeError({ op: "runReview", cause }),
          }).pipe(
            // raceFirst, not race: the watchdog only ever *fails*, and we want
            // that failure to win immediately instead of being held back waiting
            // for a run that by definition is never going to finish. Losing the
            // race interrupts the watchdog, which clears its interval.
            //
            // A watchdog kill must read as a timeout, not "Stopped by user": we
            // never abort the caller's signal. The old per-review child was
            // killed here through an *inner* controller for exactly that reason;
            // now teardown is session.interrupt in the release below, and the
            // caller's AbortSignal — which src/effect/review.ts checks to tell
            // the two apart — stays untouched.
            Effect.raceFirst(watchdog),
          );
        },
        // Release runs on success, failure, abort and watchdog alike. Interrupt
        // the session so a wedged/replaced run stops spending model money and
        // stops touching the worktree; the server itself stays up. Fire and
        // forget: a dead server must not fail the release.
        (serve) =>
          Effect.sync(() => {
            if (onAbort) signal.removeEventListener("abort", onAbort);
            if (!sessionId) return;
            openCodeManager.deregister(sessionId);
            void serve.client.session
              .interrupt({ sessionID: sessionId, resume: false })
              .catch(() => undefined);
          }),
      );
    },
  }),
}) {}
