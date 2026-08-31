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

// `/review stop` on a PR: the commenter knows the PR, not the review id, so the
// lookup goes through the same repo#pr key supersession uses. Returns how many
// runs were aborted (0 = nothing was running, worth telling the user).
export function abortReviewsForPR(repoFullName: string, prNumber: number): number {
  let n = 0;
  for (const [id, entry] of activeReviews) {
    if (entry.key === `${repoFullName}#${prNumber}`) {
      log.info("stopping review by comment", { review: id, pr: entry.key });
      entry.ctrl.abort();
      n++;
    }
  }
  return n;
}

function prKey(pr: PullRequestInfo): string {
  return `${pr.repoFullName}#${pr.number}`;
}

const AUTO_RETRY_DELAY_MS = 60_000;

// The one-retry policy, pure so it's unit-testable. Retry only a genuine
// failure (never a user stop or a supersession — those abort the controller),
// only once (attempt 0 → 1, never further), and only if nothing else is
// already reviewing the same PR by the time the delay elapses (a new push in
// the meantime owns the PR).
export function shouldAutoRetry(o: {
  failed: boolean;
  aborted: boolean;
  attempt: number;
  activeForKey: boolean;
}): boolean {
  return o.failed && !o.aborted && o.attempt === 0 && !o.activeForKey;
}

function hasActiveForKey(key: string): boolean {
  for (const entry of activeReviews.values()) if (entry.key === key) return true;
  return false;
}

// A newer commit supersedes any review still running for the same PR. Signalled
// via AbortSignal.reason so the pipeline can distinguish it from a user stop.
// `exceptId` is the new run itself, already registered in the map by the time
// the review pipeline decides to proceed — it must not abort itself.
function supersedeInFlight(key: string, exceptId?: number): void {
  for (const [id, entry] of activeReviews) {
    if (id !== exceptId && entry.key === key) {
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
  attempt: number = 0,
): Promise<void> {
  const key = prKey(pr);
  // No supersession up front any more (issue trap 3): the pipeline calls
  // onProceed once it knows this push is worth reviewing, and only then do we
  // cancel the PR's previous run. Superseding first would kill a live review and
  // then possibly skip, leaving the PR with nothing.
  const ctrl = new AbortController();
  let id: number | undefined;
  const program = reviewPipeline(
    pr,
    trigger,
    ctrl.signal,
    (rid) => {
      id = rid;
      activeReviews.set(rid, { ctrl, key });
    },
    (rid) => supersedeInFlight(key, rid),
    attempt,
  ).pipe(Effect.provide(AppLayer));

  return Effect.runPromise(program)
    .finally(() => {
      if (id !== undefined) activeReviews.delete(id);
    })
    .catch((err) => {
      // Automatic retry, once. The pipeline resolves cleanly on an abort (user
      // stop / supersession) and rejects only on a genuine failure, so a
      // rejection here plus a non-aborted controller IS the failure signal.
      // activeForKey is re-checked at fire time: a push during the delay owns
      // the PR and the retry stands down.
      if (shouldAutoRetry({ failed: true, aborted: ctrl.signal.aborted, attempt, activeForKey: false })) {
        log.info("review failed, auto-retrying in 60s", { review: id, pr: key });
        const timer = setTimeout(() => {
          const activeForKey = hasActiveForKey(key);
          if (!shouldAutoRetry({ failed: true, aborted: ctrl.signal.aborted, attempt, activeForKey })) {
            log.info("auto-retry cancelled — a newer review is already running", { pr: key });
            return;
          }
          // Same PR snapshot on purpose: the failure was ours, not the PR's.
          runReviewForPR(pr, "retry", 1).catch((e) =>
            log.error("auto-retry failed", { pr: key, error: String(e) }),
          );
        }, AUTO_RETRY_DELAY_MS);
        // Don't let a pending retry hold the process open on shutdown.
        timer.unref?.();
      }
      throw err;
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
