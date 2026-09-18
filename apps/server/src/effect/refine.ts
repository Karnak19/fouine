import { Effect, Exit } from "effect";
import { resolve } from "node:path";
import { cloneUrl, failureMessage, writeFailure } from "~/effect/review";
import {
  resolveAutoReady,
  resolveImplementLabel,
  resolveRefineModel,
  resolveRefinePrompt,
} from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { internalSecret, internalBaseUrl } from "~/server/internal";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { refineToolEnv } from "~/review/opencode";
import { buildRefinePrompt } from "~/review/refine-prompt";
import { fetchIssueInfo } from "~/github";
import { GitHubError, type ReviewError } from "~/effect/errors";

export interface RefineTarget {
  repoFullName: string;
  installationId: number;
  issueNumber: number;
  issueTitle: string;
  // Which refine round this is: 1 for the first (default when omitted), 2+ for
  // a follow-up after a human replied in the issue discussion — see
  // refineFollowUpDecision in server/webhook.ts.
  round?: number;
}

// The third pipeline on the reviews table: refine an incoming ISSUE instead of
// a diff. Checks the default branch out read-only (nothing is ever pushed) and
// lets the refiner agent post one comment with questions, acceptance criteria,
// likely files, size and risks.
// Tracked as a reviews row with trigger = 'refine' and pr_number = the issue
// number — issue and PR numbers share one sequence per repo, so there is no
// collision — so the dashboard gets status/session/cost for free.
// ponytail: refiner rides the reviews table like the improver does; dedicated
// table if the dashboard ever needs to render these runs differently.
export function refinePipeline(
  target: RefineTarget,
  signal: AbortSignal,
  onStart: (id: number) => void,
): Effect.Effect<void, ReviewError, DbService | GitHubService | GitService | OpenCodeService> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const [owner, repoName] = target.repoFullName.split("/");

    // Registration must be synchronous and come before any GitHub call — the
    // dashboard Stop button, `/fouine stop` and supersedeInFlight all key off
    // activeReviews, and a window where two triggers can both race past
    // registration means both post a comment. See improvePipeline.
    const id = yield* db.insertReview({
      repo: target.repoFullName,
      pr: target.issueNumber,
      title: target.issueTitle,
      trigger: "refine",
    });
    yield* Effect.sync(() => onStart(id));

    const run = (worktree: string) =>
      Effect.gen(function* () {
        log.info("refiner starting", {
          repo: target.repoFullName,
          review: id,
          issue: target.issueNumber,
        });
        yield* db.setRunning(id);

        const octokit = yield* gh.installationClient(target.installationId);
        const issue = yield* Effect.tryPromise({
          try: () => fetchIssueInfo(octokit, target.repoFullName, target.issueNumber),
          catch: (cause) => new GitHubError({ op: "issues.get", cause }),
        });

        const token = yield* gh.installationToken(octokit);
        const branch = yield* gh.defaultBranch(octokit, owner, repoName);

        yield* git.ensureBare(target.repoFullName, cloneUrl(token, target.repoFullName));
        const sha = yield* git.fetchRef(target.repoFullName, `refs/heads/${branch}`);
        yield* git.addWorktree(target.repoFullName, sha, worktree);

        const repoRow = yield* db.getRepo(target.repoFullName);
        const prompt = buildRefinePrompt(
          issue,
          resolveRefinePrompt(repoRow?.refine_prompt ?? null),
          target.round ?? 1,
        );
        const model = resolveRefineModel(repoRow);

        const result = yield* oc.runReview(
          {
            directory: worktree,
            prompt,
            model,
            agent: "fouine-refiner",
            transcript: { reviewId: id, repo: target.repoFullName },
            // Keeps FOUINE_PR_NUMBER on purpose — see refineToolEnv.
            env: refineToolEnv({
              githubToken: token,
              owner,
              repo: repoName,
              issueNumber: target.issueNumber,
              reviewId: id,
              internalUrl: internalBaseUrl,
              internalSecret,
              // Only when the repo opted in: without the env var,
              // mark_issue_ready is a no-op that tells the agent a human must
              // label — the flag stays the single switch for auto-labelling.
              readyLabel: resolveAutoReady(repoRow?.auto_ready ?? null)
                ? resolveImplementLabel(repoRow?.implement_label ?? null)
                : undefined,
            }),
          },
          (sessionId) =>
            Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
          signal,
        );

        log.info("refiner done", {
          repo: target.repoFullName,
          review: id,
          session: result.sessionId,
          preview: result.text.slice(0, 500),
        });
        // No patch-id: a refine run looks at no diff, so it can never be a skip
        // baseline.
        yield* db.complete(id, result.cost, result.tokens, model, null);
      });

    const guarded = Effect.suspend(() => {
      const worktree = resolve(
        config.dataDir,
        "worktrees",
        `${target.repoFullName.replace("/", "__")}#refine-${id}`,
      );
      return run(worktree).pipe(
        Effect.ensuring(git.removeWorktree(target.repoFullName, worktree)),
      );
    });

    yield* guarded.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) return;
          const message = failureMessage(exit.cause, signal, "Superseded by a newer run");
          if (signal.aborted) {
            log.info(signal.reason === "superseded" ? "refiner superseded" : "refiner stopped", {
              repo: target.repoFullName,
              review: id,
            });
          } else {
            log.error("refiner failed", {
              repo: target.repoFullName,
              review: id,
              error: message,
            });
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
