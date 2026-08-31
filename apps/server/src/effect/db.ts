import { Effect } from "effect";
import { findings, repos, reviews, type RepoRow } from "~/db";
import { DatabaseError } from "~/effect/errors";
import { publishReviewEvent } from "~/server/events";

// bun:sqlite is synchronous; each call is wrapped in Effect.try so a statement
// throwing surfaces as a typed DatabaseError instead of a raw exception. The
// overhead is negligible next to the async git/opencode work.
const attempt = <A>(op: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new DatabaseError({ op, cause }) });

export class DbService extends Effect.Service<DbService>()("app/DbService", {
  sync: () => ({
    getRepo: (fullName: string): Effect.Effect<RepoRow | null, DatabaseError> =>
      attempt("repos.get", () => repos.get.get({ $full_name: fullName }) ?? null),

    insertReview: (input: {
      repo: string;
      pr: number;
      title: string;
      trigger: string | null;
      // 0 (default) for a first run, 1 for the runner's automatic retry.
      attempt?: number;
    }): Effect.Effect<number, DatabaseError> =>
      attempt("reviews.insert", () => {
        const row = reviews.insert.get({
          $repo: input.repo,
          $pr: input.pr,
          $title: input.title,
          $session: null,
          $status: "pending",
          $trigger: input.trigger,
          $attempt: input.attempt ?? 0,
        })!;
        publishReviewEvent("created", row.id);
        return row.id;
      }),

    setRunning: (id: number): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.updateStatus", () => {
        reviews.updateStatus.run({ $status: "running", $done: 0, $id: id });
        publishReviewEvent("updated", id);
      }),

    // Current status of a row, so the failure finaliser can tell "still owed a
    // terminal write" (pending/running) from "already settled" (completed/failed)
    // and never overwrite a completed review with a failure.
    status: (id: number): Effect.Effect<string | undefined, DatabaseError> =>
      attempt("reviews.byId", () => reviews.byId.get({ $id: id })?.status),

    setSession: (id: number, session: string): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.setSession", () => {
        reviews.setSession.run({ $session: session, $id: id });
        publishReviewEvent("updated", id);
      }),

    // No event published: the check run id is reaper bookkeeping, nothing in
    // the UI reads it.
    setCheckRun: (id: number, checkRunId: number): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.setCheckRun", () => {
        reviews.setCheckRun.run({ $check: checkRunId, $id: id });
      }),

    // patchId is the diff identity this run reviewed — null when we couldn't get
    // one. Written here and nowhere else on the success path, so only a review
    // that actually finished can become a baseline for skipping.
    complete: (
      id: number,
      cost: number,
      tokens: number,
      model: string,
      patchId: string | null,
    ): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.complete", () => {
        reviews.complete.run({
          $id: id,
          $cost: cost,
          $tokens: tokens,
          $model: model,
          $patch: patchId,
        });
        publishReviewEvent("updated", id);
      }),

    // Terminal, like complete/fail — the push carried no diff change.
    skip: (id: number, patchId: string | null): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.skip", () => {
        reviews.skip.run({ $id: id, $patch: patchId });
        publishReviewEvent("updated", id);
      }),

    // Newest successfully-reviewed diff identity for this PR, or null.
    lastReviewedPatch: (
      repo: string,
      pr: number,
    ): Effect.Effect<{ id: number; patch_id: string } | null, DatabaseError> =>
      attempt(
        "reviews.lastReviewedPatch",
        () => reviews.lastReviewedPatch.get({ $repo: repo, $pr: pr }) ?? null,
      ),

    fail: (id: number, error: string): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.fail", () => {
        reviews.fail.run({ $id: id, $error: error });
        publishReviewEvent("updated", id);
      }),

    // Whether the review's post_* tools wrote anything back — i.e. the agent
    // actually posted to GitHub. Used to nudge sessions that end silent.
    hasFindings: (id: number): Effect.Effect<boolean, DatabaseError> =>
      attempt("findings.byReview", () => findings.byReview.all({ $review: id }).length > 0),
  }),
}) {}
