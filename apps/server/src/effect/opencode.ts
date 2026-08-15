import { Effect, Exit } from "effect";
import { createOpencode } from "@opencode-ai/sdk";
import { config } from "~/config";
import {
  freePort,
  newActivityState,
  observeEvent,
  runReview,
  stalledTool,
  watchdogVerdict,
  type RunOptions,
  type RunResult,
} from "~/review/opencode";
import { OpenCodeError } from "~/effect/errors";
import { log } from "~/server/log";

// How often the watchdog re-evaluates. Cheap (one Date.now() compare), and the
// resolution only needs to be coarse relative to the minute-scale timeouts.
const WATCHDOG_TICK_MS = 5_000;

// Each review runs in its own opencode subprocess, which snapshots the parent's
// process.env at spawn — and the custom tools read their GitHub context
// (FOUINE_*) from that inherited env. The SDK gives no per-spawn env hook, so we
// stage opts.env onto the shared process.env right before spawning. That write →
// spawn window is the bug in #23: with two reviews running at once, one could
// stage its context and a second could overwrite it before the first spawns,
// pointing the first review's tools at the wrong PR/token. A mutex serialises
// just that window. Reviews still run concurrently once spawned, so cross-PR
// throughput is unaffected — only the sub-second startup is serialised.
const spawnLock = Effect.unsafeMakeSemaphore(1);

// Effect-native lifecycle: acquireRelease guarantees server.close() runs even
// if the review is interrupted or fails — the same guarantee the old
// try/finally gave, but composed. The session dance itself reuses the existing
// runReview() so there's one implementation of the SDK calls.
export class OpenCodeService extends Effect.Service<OpenCodeService>()("app/OpenCodeService", {
  sync: () => ({
    runReview: (
      opts: RunOptions,
      onSession: (id: string) => void,
      signal: AbortSignal,
    ): Effect.Effect<RunResult, OpenCodeError> =>
      Effect.acquireUseRelease(
        spawnLock.withPermits(1)(
          Effect.tryPromise({
            try: async () => {
              const port = await freePort();
              // The child is spawned with our *own* controller, chained to the
              // caller's signal, so the watchdog below can kill it exactly the
              // way the dashboard Stop button does. Killing it matters: a wedged
              // opencode holds a subprocess (and, before it, the spawn lock), and
              // abandoning the Effect alone would leave that orphan alive.
              const ctrl = new AbortController();
              const onAbort = () => ctrl.abort(signal.reason);
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
              // Stage under the lock, immediately before spawn: no other review
              // can overwrite process.env between here and createOpencode's
              // (synchronous) spawn, so the subprocess snapshots this review's
              // context. No restore needed — the parent never reads FOUINE_*.
              // Clear first: Object.assign only overwrites the keys present in
              // opts.env, so a key the *previous* spawn set and this one omits
              // would leak. improveToolEnv deliberately drops FOUINE_PR_NUMBER,
              // and inheriting a stale one points the improver at a real PR.
              if (opts.env) {
                for (const key of Object.keys(process.env)) {
                  if (key.startsWith("FOUINE_")) delete process.env[key];
                }
                Object.assign(process.env, opts.env);
              }
              const oc = await createOpencode({ port, signal: ctrl.signal });
              return {
                ...oc,
                ctrl,
                detach: () => signal.removeEventListener("abort", onAbort),
              };
            },
            catch: (cause) => new OpenCodeError({ op: "createOpencode", cause }),
          }),
        ),
        ({ client, ctrl }) => {
          // The watchdog #60 was missing: opencode can wedge mid-tool-call and
          // never return, which left the review row at `running` forever. It is
          // now driven by activity rather than elapsed time — see the long
          // comment above watchdogVerdict in src/review/opencode.ts for why.
          const state = newActivityState(Date.now());
          // The session id only exists after runReview creates it, so events are
          // matched against this box. Nothing arrives for the session before it
          // exists anyway, and create-to-prompt is milliseconds.
          const session: { id?: string } = {};

          // Fire-and-forget pump. Deliberately NOT part of the Effect: a broken
          // event stream must degrade the watchdog, never fail a review. The idle
          // rule stays disarmed until an event actually MATCHES this session, so a
          // subscribe that throws, a stream that dies, and a stream carrying the
          // wrong instance's events all fall back to the plain absolute ceiling —
          // the pre-#67 behaviour. Teardown is free: the SSE fetch rides `ctrl.signal`, and
          // ctrl is aborted on every exit path (onExit below on failure, release
          // unconditionally), so the connection and this loop always end.
          void (async () => {
            try {
              // `query.directory` is NOT optional in practice, whatever the type
              // says. opencode resolves an instance per project directory and
              // `/event` only streams the events of the instance the request
              // routed to; with no directory it routes to `process.cwd()` —
              // fouine's own /app — so we got a healthy socket carrying the
              // WRONG instance's events, matched none of them, and killed every
              // review at exactly idleTimeoutMs. The session is created with this
              // same directory (see runReview), so both must agree.
              const sub = await client.event.subscribe({
                query: { directory: opts.directory },
                signal: ctrl.signal,
              });
              for await (const event of sub.stream) {
                observeEvent(state, event, session.id, Date.now());
              }
            } catch (cause) {
              if (!ctrl.signal.aborted) {
                log.warn("opencode event stream lost, idle watchdog disabled", {
                  cause: String(cause),
                });
              }
            } finally {
              // Disarm on stream death: a heartbeat that can no longer arrive
              // must not read as a silent model.
              state.armed = false;
            }
          })();

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
                session: session.id,
                verdict,
                tool: stalled?.tool,
                input: stalled?.input,
              });
              resume(Effect.fail(new OpenCodeError({ op: "runReview", cause: verdict })));
            }, WATCHDOG_TICK_MS);
            return Effect.sync(() => clearInterval(timer));
          });

          return Effect.tryPromise({
            try: () =>
              runReview(client, opts, (id) => {
                session.id = id;
                onSession(id);
              }),
            catch: (cause) => new OpenCodeError({ op: "runReview", cause }),
          }).pipe(
            // raceFirst, not race: the watchdog only ever *fails*, and we want
            // that failure to win immediately instead of being held back waiting
            // for a run that by definition is never going to finish. Losing the
            // race interrupts the watchdog, which clears its interval.
            Effect.raceFirst(watchdog),
            // Abort as soon as we stop waiting (timeout, failure, interrupt) so
            // the child dies now rather than at release — release still runs and
            // closes the server either way. Note this aborts our *inner* ctrl
            // only: the caller's signal stays untouched, which is what keeps a
            // watchdog kill reportable as a timeout rather than as "Stopped by
            // user" (src/effect/review.ts checks signal.aborted to tell them
            // apart). Do not "fix" this by aborting the outer signal.
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (Exit.isSuccess(exit)) return;
                try {
                  ctrl.abort("timeout");
                } catch {
                  // aborting an already-dead child is not our problem
                }
              }),
            ),
          );
        },
        ({ server, ctrl, detach }) =>
          Effect.sync(() => {
            detach();
            try {
              ctrl.abort("cleanup");
            } catch {
              // ignore
            }
            try {
              server.close();
            } catch {
              // ignore — the release must never fail, or the lock/child leak
            }
          }),
      ),
  }),
}) {}
