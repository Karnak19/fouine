import { Effect } from "effect";
import { createOpencode } from "@opencode-ai/sdk";
import { freePort, runReview, type RunOptions, type RunResult } from "~/review/opencode";
import { OpenCodeError } from "~/effect/errors";

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
        Effect.tryPromise({
          try: async () => createOpencode({ port: await freePort(), signal }),
          catch: (cause) => new OpenCodeError({ op: "createOpencode", cause }),
        }),
        ({ client }) =>
          Effect.tryPromise({
            try: () => runReview(client, opts, onSession),
            catch: (cause) => new OpenCodeError({ op: "runReview", cause }),
          }),
        ({ server }) => Effect.sync(() => server.close()),
      ),
  }),
}) {}
