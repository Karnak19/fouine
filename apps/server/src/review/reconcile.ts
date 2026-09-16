import { Effect } from "effect";
import { AppLayer, reconcileStaleChecks } from "~/effect";
import { log } from "~/server/log";

// Hourly + boot backstop for check runs left open (see reconcileStaleChecks).
// Never throws: a failed sweep is logged and retried on the next tick, and must
// never block boot.
export async function reconcileReviewChecks(): Promise<void> {
  try {
    await Effect.runPromise(reconcileStaleChecks().pipe(Effect.provide(AppLayer)));
  } catch (err) {
    log.error("stale-check reconcile sweep failed", { error: String(err) });
  }
}
