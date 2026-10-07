import { Effect, Exit } from "effect";
import { resolve } from "node:path";
import type { Octokit } from "octokit";
import { cloneUrl, failureMessage, writeFailure } from "~/effect/review";
import { config } from "~/config";
import { log } from "~/server/log";
import { DbService } from "~/effect/db";
import { GitService } from "~/effect/git";
import { installDeps } from "~/effect/install";
import { GitHubError, type ReviewError } from "~/effect/errors";

// The part of "an agent changes code in a worktree and fouine opens a PR" that
// the issue implementer (effect/implement.ts) and the chat's delegated task
// (effect/task.ts) have in common. Each pipeline keeps what differs — where the
// prompt comes from, which agent, what happens when the diff is empty, how the
// result is reported.

export const worktreePathFor = (repoFullName: string, kind: string, id: number): string =>
  resolve(config.dataDir, "worktrees", `${repoFullName.replace("/", "__")}#${kind}-${id}`);

// Clone/refresh the bare repo, check `ref` out into `worktree`, install deps and
// reset what the install touched.
export function prepareWorktree(opts: {
  repoFullName: string;
  token: string;
  ref: string;
  worktree: string;
  signal: AbortSignal;
}): Effect.Effect<void, ReviewError, GitService> {
  return Effect.gen(function* () {
    const git = yield* GitService;
    yield* git.ensureBare(opts.repoFullName, cloneUrl(opts.token, opts.repoFullName));
    const sha = yield* git.fetchRef(opts.repoFullName, opts.ref);
    yield* git.addWorktree(opts.repoFullName, sha, opts.worktree);
    yield* installDeps(opts.worktree, opts.signal);
    // bun install may rewrite the lockfile (no --frozen-lockfile, see
    // install.ts); that churn must not end up in the PR, so reset tracked
    // files before the agent starts.
    yield* git.discardChanges(opts.worktree);
  });
}

export function openPullRequest(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
}): Effect.Effect<string, GitHubError> {
  return Effect.tryPromise({
    try: () =>
      opts.octokit.rest.pulls.create({
        owner: opts.owner,
        repo: opts.repo,
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body,
      }),
    catch: (cause) => new GitHubError({ op: "pulls.create", cause }),
  }).pipe(Effect.map((created) => created.data.html_url));
}

// Wraps a run so the worktree is always removed and any failure ends in a
// terminal `failed` row (never overwriting one already settled). `label` only
// names the pipeline in logs.
export function guardRun<R>(
  opts: {
    label: string;
    repoFullName: string;
    id: number;
    kind: string;
    signal: AbortSignal;
  },
  run: (worktree: string) => Effect.Effect<unknown, ReviewError, R>,
): Effect.Effect<void, ReviewError, DbService | GitService | R> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const git = yield* GitService;
    const { label, repoFullName, id, signal } = opts;

    const guarded = Effect.suspend(() => {
      const worktree = worktreePathFor(repoFullName, opts.kind, id);
      return run(worktree).pipe(Effect.ensuring(git.removeWorktree(repoFullName, worktree)));
    });

    yield* guarded.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) return;
          const message = failureMessage(exit.cause, signal, "Superseded by a newer run");
          if (signal.aborted) {
            log.info(signal.reason === "superseded" ? `${label} superseded` : `${label} stopped`, {
              repo: repoFullName,
              review: id,
            });
          } else {
            log.error(`${label} failed`, { repo: repoFullName, review: id, error: message });
          }
          const current = yield* db
            .status(id)
            .pipe(Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)));
          if (current === "completed" || current === "failed") return;
          yield* writeFailure(db, id, message);
        }),
      ),
      Effect.catchAll((err) => (signal.aborted ? Effect.void : Effect.fail(err))),
    );
  });
}
