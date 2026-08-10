import { Duration, Effect, Exit } from "effect";
import { createOpencode } from "@opencode-ai/sdk";
import { config } from "~/config";
import { freePort, runReview, type RunOptions, type RunResult } from "~/review/opencode";
import { OpenCodeError } from "~/effect/errors";

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
        ({ client, ctrl }) =>
          Effect.tryPromise({
            try: () => runReview(client, opts, onSession),
            catch: (cause) => new OpenCodeError({ op: "runReview", cause }),
          }).pipe(
            // The watchdog #60 was missing: opencode can wedge mid-tool-call and
            // never return, which left the review row at `running` forever.
            Effect.timeoutFail({
              duration: Duration.millis(config.review.timeoutMs),
              onTimeout: () =>
                new OpenCodeError({
                  op: "runReview",
                  cause: `timed out after ${Math.round(config.review.timeoutMs / 1000)}s`,
                }),
            }),
            // Abort as soon as we stop waiting (timeout, failure, interrupt) so
            // the child dies now rather than at release — release still runs and
            // closes the server either way.
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
          ),
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
