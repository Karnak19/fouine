import { Effect } from "effect";
import { repos, reviews, type RepoRow } from "~/db";
import { DatabaseError } from "~/effect/errors";

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
    }): Effect.Effect<number, DatabaseError> =>
      attempt("reviews.insert", () => {
        const row = reviews.insert.get({
          $repo: input.repo,
          $pr: input.pr,
          $title: input.title,
          $session: null,
          $status: "pending",
          $trigger: input.trigger,
        })!;
        return row.id;
      }),

    setRunning: (id: number): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.updateStatus", () => {
        reviews.updateStatus.run({ $status: "running", $done: 0, $id: id });
      }),

    setSession: (id: number, session: string): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.setSession", () => {
        reviews.setSession.run({ $session: session, $id: id });
      }),

    complete: (
      id: number,
      cost: number,
      tokens: number,
      model: string,
    ): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.complete", () => {
        reviews.complete.run({ $id: id, $cost: cost, $tokens: tokens, $model: model });
      }),

    fail: (id: number, error: string): Effect.Effect<void, DatabaseError> =>
      attempt("reviews.fail", () => {
        reviews.fail.run({ $id: id, $error: error });
      }),
  }),
}) {}
