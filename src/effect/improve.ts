import { Effect, Exit } from "effect";
import { resolve } from "node:path";
import { cloneUrl, failureMessage, readRepoNotes, writeFailure } from "~/effect/review";
import { resolveImproverModel } from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { internalSecret, internalBaseUrl } from "~/server/internal";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { improveToolEnv } from "~/review/opencode";
import { GitHubError, type ReviewError } from "~/effect/errors";

export interface ImproveTarget {
  repoFullName: string;
  installationId: number;
  prNumbers: number[];
}

// Must match BRANCH in opencode-config/tools/propose_review_notes.ts.
export const PROPOSAL_BRANCH = "fouine/review-notes";

export function buildImprovePrompt(
  target: ImproveTarget,
  defaultBranch: string,
  currentNotes: string | undefined,
  pendingProposal = false,
): string {
  return [
    `# Review-notes improvement pass`,
    ``,
    `- Repository: ${target.repoFullName}`,
    `- Default branch: ${defaultBranch}`,
    `- Checked out here: ${pendingProposal ? `${PROPOSAL_BRANCH} (open proposal PR)` : defaultBranch}`,
    ``,
    `fouine recently reviewed these PRs: ${target.prNumbers.map((n) => `#${n}`).join(", ")}`,
    ``,
    `Read the human feedback on those review threads (get_prior_reviews with each number),`,
    `distill the durable learnings, and propose an updated REVIEW.md via propose_review_notes —`,
    `or reply "no learnings" if there is nothing worth remembering.`,
    ``,
    pendingProposal
      ? `## Current REVIEW.md (from the still-open proposal PR, not yet merged — build on it, do not drop what it already added)`
      : `## Current REVIEW.md`,
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

    const run = (worktree: string) =>
      Effect.gen(function* () {
        log.info("improver starting", {
          repo: target.repoFullName,
          review: id,
          prs: target.prNumbers,
        });
        yield* db.setRunning(id);

        const octokit = yield* gh.installationClient(target.installationId);
        const token = yield* gh.installationToken(octokit);
        const branch = yield* gh.defaultBranch(octokit, owner, repoName);

        // If a previous proposal is still open and unmerged, check that branch
        // out instead of the default one. Otherwise the agent reads the default
        // branch's REVIEW.md, rewrites it whole, and silently reverts learnings
        // a human hasn't merged yet.
        // Fails closed on purpose: an unknown proposal state must not fall back
        // to the default branch, or a transient GitHub error would undo an open
        // proposal. Failing the run is cheap — the marker doesn't advance, so
        // the next sweep retries.
        const pending = yield* Effect.tryPromise({
          try: () =>
            octokit.rest.pulls.list({
              owner,
              repo: repoName,
              state: "open",
              head: `${owner}:${PROPOSAL_BRANCH}`,
            }),
          catch: (cause) => new GitHubError({ op: "pulls.list", cause }),
        }).pipe(Effect.map((res) => res.data.length > 0));
        const checkout = pending ? PROPOSAL_BRANCH : branch;

        yield* git.ensureBare(target.repoFullName, cloneUrl(token, target.repoFullName));
        const sha = yield* git.fetchRef(target.repoFullName, `refs/heads/${checkout}`);
        yield* git.addWorktree(target.repoFullName, sha, worktree);

        const currentNotes = yield* readRepoNotes(worktree);
        const prompt = buildImprovePrompt(target, branch, currentNotes, pending);
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
        // No patch-id: an improver run reviews no diff, so it can never be a
        // skip baseline (lastReviewedPatch also filters it out by pr_number > 0).
        yield* db.complete(id, result.cost, result.tokens, model, null);
      });

    // Same shape as reviewPipeline: the worktree path lives inside the guarded
    // region so nothing between the `pending` insert and the run can strand the
    // row, and the finaliser covers defects and interrupts too (#60).
    const guarded = Effect.suspend(() => {
      const worktree = resolve(
        config.dataDir,
        "worktrees",
        `${target.repoFullName.replace("/", "__")}#improve-${id}`,
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
            log.info(signal.reason === "superseded" ? "improver superseded" : "improver stopped", {
              repo: target.repoFullName,
              review: id,
            });
          } else {
            log.error("improver failed", {
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
