import { Effect, Ref } from "effect";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Octokit } from "octokit";
import type { PullRequestInfo } from "~/review/types";
import { buildPrompt } from "~/review/prompt";
import { resolveDefaultModel, resolvePrompt } from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { type ReviewError } from "~/effect/errors";

function cloneUrl(token: string, fullName: string): string {
  return `https://x-access-token:${token}@github.com/${fullName}.git`;
}

// Repo-local REVIEW.md if the repo ships one — additive guidance. Never fails.
const readRepoNotes = (worktree: string): Effect.Effect<string | undefined> =>
  Effect.tryPromise(() => readFile(resolve(worktree, "REVIEW.md"), "utf8")).pipe(
    Effect.map((s) => s.trim() || undefined),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

// The full review as one typed Effect. `signal` comes from the runner's
// AbortController (dashboard Stop button); the opencode SDK observes it and an
// abort surfaces as a failure that the handler recognises via signal.aborted.
export function reviewPipeline(
  pr: PullRequestInfo,
  trigger: string | null,
  signal: AbortSignal,
  // Called once the review row exists, so the runner can register its
  // AbortController in the live-reviews map (keyed by this id) before the long
  // git/opencode work starts.
  onStart: (id: number) => void,
): Effect.Effect<
  void,
  ReviewError,
  DbService | GitHubService | GitService | OpenCodeService
> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const repo = yield* db.getRepo(pr.repoFullName);
    const id = yield* db.insertReview({
      repo: pr.repoFullName,
      pr: pr.number,
      title: pr.title,
      trigger,
    });
    yield* Effect.sync(() => onStart(id));

    const [owner, repoName] = pr.repoFullName.split("/");
    const worktree = resolve(
      config.dataDir,
      "worktrees",
      `${pr.repoFullName.replace("/", "__")}#${pr.number}-${id}`,
    );

    // Held so the failure handler can finish the check even though octokit /
    // checkRunId are only acquired partway through the run.
    const octokitRef = yield* Ref.make<Octokit | undefined>(undefined);
    const checkRef = yield* Ref.make<number | undefined>(undefined);

    const run = Effect.gen(function* () {
      log.info("review starting", { repo: pr.repoFullName, number: pr.number, review: id });
      yield* db.setRunning(id);

      const octokit = yield* gh.installationClient(pr.installationId);
      yield* Ref.set(octokitRef, octokit);
      const checkRunId = yield* gh.startCheck(octokit, owner, repoName, pr.headSha);
      yield* Ref.set(checkRef, checkRunId);
      const token = yield* gh.installationToken(octokit);

      yield* git.ensureBare(pr.repoFullName, cloneUrl(token, pr.repoFullName));
      yield* git.fetchRef(pr.repoFullName, `refs/pull/${pr.number}/head`);
      yield* git.addWorktree(pr.repoFullName, pr.headSha, worktree);
      log.info("worktree ready", { repo: pr.repoFullName, number: pr.number, path: worktree });

      const repoNotes = yield* readRepoNotes(worktree);
      const prompt = buildPrompt(pr, resolvePrompt(repo?.prompt ?? null), repoNotes);

      // Custom tools (opencode-config/tools) read these to post to GitHub.
      yield* Effect.sync(() => {
        process.env.FOUINE_GITHUB_TOKEN = token;
        process.env.FOUINE_REPO_OWNER = owner;
        process.env.FOUINE_REPO_NAME = repoName;
        process.env.FOUINE_PR_NUMBER = String(pr.number);
      });

      const result = yield* oc.runReview(
        {
          directory: worktree,
          prompt,
          model: repo?.model ?? resolveDefaultModel(),
        },
        // Persist the session id as soon as it exists so the dashboard can
        // stream `opencode export` mid-flight. setSession is a sync SQLite
        // write, so runSync completes it in place like the old callback.
        (sessionId) =>
          Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
        signal,
      );

      log.info("review done", {
        repo: pr.repoFullName,
        number: pr.number,
        review: id,
        session: result.sessionId,
        textChars: result.text.length,
        preview: result.text.slice(0, 500),
      });
      yield* db.complete(id, result.cost, result.tokens);
      yield* gh.finishCheck(octokit, owner, repoName, checkRunId, "success", result.text);
    });

    yield* run.pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          // A user-initiated stop isn't an error — don't pollute error monitoring.
          const aborted = signal.aborted;
          const message = aborted ? "Stopped by user" : String(err.cause);
          if (aborted) {
            log.info("review stopped", { repo: pr.repoFullName, number: pr.number, review: id });
          } else {
            log.error("review failed", {
              repo: pr.repoFullName,
              number: pr.number,
              review: id,
              error: message,
            });
          }
          yield* db.fail(id, message).pipe(Effect.catchAll(() => Effect.void));
          const octokit = yield* Ref.get(octokitRef);
          if (octokit) {
            const checkRunId = yield* Ref.get(checkRef);
            yield* gh.finishCheck(octokit, owner, repoName, checkRunId, "failure", message);
          }
          // Intentional stop → succeed (swallow). Real failure → propagate so
          // the caller's .catch logs it, as the old `throw err` did.
          if (!aborted) yield* Effect.fail(err);
        }),
      ),
      // Guaranteed cleanup on success, failure, or interruption.
      Effect.ensuring(git.removeWorktree(pr.repoFullName, worktree)),
    );
  });
}
