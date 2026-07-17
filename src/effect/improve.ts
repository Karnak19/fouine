import { Effect } from "effect";
import { resolve } from "node:path";
import { cloneUrl, readRepoNotes } from "~/effect/review";
import { resolveImproverModel } from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { internalSecret, internalBaseUrl } from "~/server/internal";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { improveToolEnv } from "~/review/opencode";
import { type ReviewError } from "~/effect/errors";

export interface ImproveTarget {
  repoFullName: string;
  installationId: number;
  prNumbers: number[];
}

export function buildImprovePrompt(
  target: ImproveTarget,
  defaultBranch: string,
  currentNotes: string | undefined,
): string {
  return [
    `# Review-notes improvement pass`,
    ``,
    `- Repository: ${target.repoFullName}`,
    `- Default branch: ${defaultBranch} (checked out in the current directory)`,
    ``,
    `fouine recently reviewed these PRs: ${target.prNumbers.map((n) => `#${n}`).join(", ")}`,
    ``,
    `Read the human feedback on those review threads (get_prior_reviews with each number),`,
    `distill the durable learnings, and propose an updated REVIEW.md via propose_review_notes —`,
    `or reply "no learnings" if there is nothing worth remembering.`,
    ``,
    `## Current REVIEW.md`,
    ``,
    currentNotes ?? "_(none yet — you would be creating it)_",
  ].join("\n");
}

// The outer self-improvement loop: check out the default branch, hand the
// improver agent the recently reviewed PRs plus the current REVIEW.md, and let
// it propose an update as a PR (via the propose_review_notes tool). Mirrors
// reviewPipeline minus the PR-bound parts (no check run, no findings).
// Tracked as a reviews row with pr_number = 0 and trigger = 'improve' so the
// dashboard gets status/session/cost for free.
// ponytail: improver rides the reviews table; dedicated table if the dashboard
// ever needs to render these runs differently.
export function improvePipeline(
  target: ImproveTarget,
  signal: AbortSignal,
  onStart: (id: number) => void,
): Effect.Effect<void, ReviewError, DbService | GitHubService | GitService | OpenCodeService> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const id = yield* db.insertReview({
      repo: target.repoFullName,
      pr: 0,
      title: "REVIEW.md improver",
      trigger: "improve",
    });
    yield* Effect.sync(() => onStart(id));

    const [owner, repoName] = target.repoFullName.split("/");
    const worktree = resolve(
      config.dataDir,
      "worktrees",
      `${target.repoFullName.replace("/", "__")}#improve-${id}`,
    );

    const run = Effect.gen(function* () {
      log.info("improver starting", {
        repo: target.repoFullName,
        review: id,
        prs: target.prNumbers,
      });
      yield* db.setRunning(id);

      const octokit = yield* gh.installationClient(target.installationId);
      const token = yield* gh.installationToken(octokit);
      const branch = yield* gh.defaultBranch(octokit, owner, repoName);

      yield* git.ensureBare(target.repoFullName, cloneUrl(token, target.repoFullName));
      const sha = yield* git.fetchRef(target.repoFullName, `refs/heads/${branch}`);
      yield* git.addWorktree(target.repoFullName, sha, worktree);

      const currentNotes = yield* readRepoNotes(worktree);
      const prompt = buildImprovePrompt(target, branch, currentNotes);
      const model = resolveImproverModel();

      const result = yield* oc.runReview(
        {
          directory: worktree,
          prompt,
          model,
          agent: "fouine-improver",
          env: improveToolEnv({
            githubToken: token,
            owner,
            repo: repoName,
            reviewId: id,
            internalUrl: internalBaseUrl,
            internalSecret,
          }),
        },
        (sessionId) =>
          Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
        signal,
      );

      log.info("improver done", {
        repo: target.repoFullName,
        review: id,
        session: result.sessionId,
        preview: result.text.slice(0, 500),
      });
      yield* db.complete(id, result.cost, result.tokens, model);
    });

    yield* run.pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          const message = signal.aborted ? "Stopped by user" : String(err.cause);
          if (signal.aborted) {
            log.info("improver stopped", { repo: target.repoFullName, review: id });
          } else {
            log.error("improver failed", {
              repo: target.repoFullName,
              review: id,
              error: message,
            });
          }
          yield* db.fail(id, message).pipe(Effect.catchAll(() => Effect.void));
          if (!signal.aborted) yield* Effect.fail(err);
        }),
      ),
      Effect.ensuring(git.removeWorktree(target.repoFullName, worktree)),
    );
  });
}
