import { Effect, Schedule } from "effect";
import { addWorktree, ensureBare, fetchRef, patchId, removeWorktree } from "~/git/worktree";
import { log } from "~/server/log";
import { GitError } from "~/effect/errors";

// Exponential backoff × 3 total attempts (500ms, 1s) on the network-touching
// git ops. Local worktree add/remove don't retry — a failure there is a real
// problem, not a flaky network. tapError logs each failed attempt so a retried
// clone/fetch is visible, not silent.
const retryNetwork = Schedule.exponential("500 millis").pipe(Schedule.compose(Schedule.recurs(2)));

const withRetry = <A>(op: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new GitError({ op, cause }) }).pipe(
    Effect.tapError((err) => Effect.sync(() => log.warn("git op failed, retrying", { op, error: String(err.cause) }))),
    Effect.retry(retryNetwork),
  );

export class GitService extends Effect.Service<GitService>()("app/GitService", {
  sync: () => ({
    ensureBare: (fullName: string, cloneUrl: string): Effect.Effect<string, GitError> =>
      withRetry("ensureBare", () => ensureBare(fullName, cloneUrl)),

    fetchRef: (fullName: string, ref: string): Effect.Effect<string, GitError> =>
      withRetry("fetchRef", () => fetchRef(fullName, ref)),

    addWorktree: (fullName: string, sha: string, target: string): Effect.Effect<void, GitError> =>
      Effect.tryPromise({
        try: () => addWorktree(fullName, sha, target),
        catch: (cause) => new GitError({ op: "addWorktree", cause }),
      }),

    // Never fails: an unavailable patch-id degrades to "run the review", which is
    // always the safe direction.
    patchId: (
      fullName: string,
      baseRef: string,
      headSha: string,
      reviewId: number,
    ): Effect.Effect<string | undefined> =>
      Effect.promise(() => patchId(fullName, baseRef, headSha, reviewId)),

    // Cleanup is best-effort — removeWorktree already falls back to rmSync and
    // prunes and never rejects; a failure there must never mask the review.
    removeWorktree: (fullName: string, target: string): Effect.Effect<void> =>
      Effect.promise(() => removeWorktree(fullName, target)),
  }),
}) {}
