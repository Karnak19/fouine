import { Context, Effect, Layer } from "effect";
import { DatabaseError } from "~/effect/errors";

// scratch probe for the v4 service pattern — delete before review
export class ProbeService extends Context.Service<ProbeService>()(
  "app/ProbeService",
  {
    make: Effect.sync(() => ({
      get: (n: number): Effect.Effect<number, DatabaseError> => Effect.succeed(n),
    })),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

export const probeProgram = Effect.gen(function* () {
  const svc = yield* ProbeService;
  return yield* svc.get(1);
});

// Run the probe to validate the whole pattern end-to-end at runtime.
if (process.env.PROBE) {
  const out = await Effect.runPromise(probeProgram.pipe(Effect.provide(ProbeService.layer)));
  console.log("probe result:", out);
}
