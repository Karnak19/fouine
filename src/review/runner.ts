import { Effect } from "effect";
import type { PullRequestInfo } from "~/review/types";
import { AppLayer, reviewPipeline } from "~/effect";
import { improvePipeline, type ImproveTarget } from "~/effect/improve";
import { log } from "~/server/log";

// ponytail: tracks live reviews so the dashboard Stop button can abort the
// underlying opencode server — not just flip the DB row (which would leave a
// still-alive review free to post stale comments after the user stopped it).
// A missing entry means the review already finished or the process died; the
// latter is a true zombie the Stop route has to clean up in the DB alone.
// `key` is repo#pr so a new push can supersede the same PR's in-flight review.
const activeReviews = new Map<number, { ctrl: AbortController; key: string }>();

export function abortReview(id: number): boolean {
  const entry = activeReviews.get(id);
  if (!entry) return false;
  entry.ctrl.abort(); // user stop → the pipeline reports "Stopped by user"
  return true;
}

function prKey(pr: PullRequestInfo): string {
  return `${pr.repoFullName}#${pr.number}`;
}

// A newer commit supersedes any review still running for the same PR. Signalled
// via AbortSignal.reason so the pipeline can distinguish it from a user stop.
function supersedeInFlight(key: string): void {
  for (const [id, entry] of activeReviews) {
    if (entry.key === key) {
      log.info("superseding in-flight review", { review: id, pr: key });
      entry.ctrl.abort("superseded");
    }
  }
}

// Thin bridge: Elysia calls this, it runs the Effect pipeline. The pipeline
// owns status/checks/cleanup/typed-error handling; the runner only owns the
// AbortController lifecycle so abortReview() stays a synchronous lookup.
export function runReviewForPR(
  pr: PullRequestInfo,
  trigger: string | null = null,
): Promise<void> {
  const key = prKey(pr);
  // Cancel any review still running for this PR before starting the new one.
  // Safe to run before registering below — the new review isn't in the map yet.
  supersedeInFlight(key);

  const ctrl = new AbortController();
  let id: number | undefined;
  const program = reviewPipeline(pr, trigger, ctrl.signal, (rid) => {
    id = rid;
    activeReviews.set(rid, { ctrl, key });
  }).pipe(Effect.provide(AppLayer));

  return Effect.runPromise(program).finally(() => {
    if (id !== undefined) activeReviews.delete(id);
  });
}

// Same bridge for the outer-loop improver. Registers in the same map, so the
// dashboard Stop button and re-trigger supersession work like for reviews.
export function runImprove(target: ImproveTarget): Promise<void> {
  const key = `${target.repoFullName}#improve`;
  supersedeInFlight(key);

  const ctrl = new AbortController();
  let id: number | undefined;
  const program = improvePipeline(target, ctrl.signal, (rid) => {
    id = rid;
    activeReviews.set(rid, { ctrl, key });
  }).pipe(Effect.provide(AppLayer));

  return Effect.runPromise(program).finally(() => {
    if (id !== undefined) activeReviews.delete(id);
  });
}
