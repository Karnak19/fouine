import { Effect } from "effect";
import type { PullRequestInfo } from "~/review/types";
import { AppLayer, reviewPipeline } from "~/effect";

// ponytail: tracks live reviews so the dashboard Stop button can abort the
// underlying opencode server — not just flip the DB row (which would leave a
// still-alive review free to post stale comments after the user stopped it).
// A missing entry means the review already finished or the process died; the
// latter is a true zombie the Stop route has to clean up in the DB alone.
const activeReviews = new Map<number, AbortController>();
export function abortReview(id: number): boolean {
  const ctrl = activeReviews.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

// Thin bridge: Elysia calls this, it runs the Effect pipeline. The pipeline
// owns status/checks/cleanup/typed-error handling; the runner only owns the
// AbortController lifecycle so abortReview() stays a synchronous lookup.
export function runReviewForPR(
  pr: PullRequestInfo,
  trigger: string | null = null,
): Promise<void> {
  const ctrl = new AbortController();
  let id: number | undefined;
  const program = reviewPipeline(pr, trigger, ctrl.signal, (rid) => {
    id = rid;
    activeReviews.set(rid, ctrl);
  }).pipe(Effect.provide(AppLayer));

  return Effect.runPromise(program).finally(() => {
    if (id !== undefined) activeReviews.delete(id);
  });
}
