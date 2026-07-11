import { Effect } from "effect";
import { createOpencode } from "@opencode-ai/sdk";
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
              // Stage under the lock, immediately before spawn: no other review
              // can overwrite process.env between here and createOpencode's
              // (synchronous) spawn, so the subprocess snapshots this review's
              // context. No restore needed — the parent never reads FOUINE_*.
              if (opts.env) Object.assign(process.env, opts.env);
              return createOpencode({ port, signal });
            },
            catch: (cause) => new OpenCodeError({ op: "createOpencode", cause }),
          }),
        ),
        ({ client }) =>
          Effect.tryPromise({
            try: () => runReview(client, opts, onSession),
            catch: (cause) => new OpenCodeError({ op: "runReview", cause }),
          }),
        ({ server }) => Effect.sync(() => server.close()),
      ),
  }),
}) {}
