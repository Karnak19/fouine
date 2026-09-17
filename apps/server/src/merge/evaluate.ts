// Orchestrates one merger evaluation for an armed PR (#117): load the arm,
// fetch fresh GitHub state, run the pure shouldMerge decision, and either wait
// for the next event or merge + post the recap. Called from every webhook
// handler that can move an armed PR's state (see server/webhook.ts).

import { Effect } from "effect";
import { findings, mergeArms, repos, reviews } from "~/db";
import { resolveAutoMerge, resolveMergeMethod } from "~/settings";
import { GitHubService } from "~/effect/github";
import { shouldMerge, type MergeReview, type MergeState } from "~/merge/decide";
import { renderRecap } from "~/merge/recap";
import { log } from "~/server/log";

// ponytail: in-memory promise chain per (repo, pr) — a single process is all
// this app runs, so this is enough to serialise concurrent webhooks for the
// same PR (issue trap: concurrent evaluations). Multi-process would need a DB
// lock instead.
const chains = new Map<string, Promise<void>>();

export function evaluateArm(repoFullName: string, prNumber: number): Promise<void> {
  const key = `${repoFullName}#${prNumber}`;
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // a previous failure must not poison the chain forever
    .then(() => runEvaluation(repoFullName, prNumber))
    .catch((err) => {
      log.error("merge evaluation failed", { repo: repoFullName, pr: prNumber, error: String(err) });
    });
  chains.set(key, next);
  return next;
}

function runEvaluation(repoFullName: string, prNumber: number): Promise<void> {
  return Effect.runPromise(
    evaluatePipeline(repoFullName, prNumber).pipe(Effect.provide(GitHubService.Default)),
  );
}

export function evaluatePipeline(
  repoFullName: string,
  prNumber: number,
): Effect.Effect<void, never, GitHubService> {
  return Effect.gen(function* () {
    const gh = yield* GitHubService;

    const arm = yield* Effect.sync(() => mergeArms.get.get({ $repo: repoFullName, $pr: prNumber }));
    if (!arm) return; // not armed — every handler is meant to check this first, but defence in depth is free

    const repo = yield* Effect.sync(() => repos.get.get({ $full_name: repoFullName }));
    if (!repo || !repo.enabled || !resolveAutoMerge(repo.auto_merge)) return;

    const [owner, repoName] = repoFullName.split("/");
    const octokit = yield* gh
      .installationClient(repo.installation_id)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!octokit) return;

    let pull = yield* gh
      .getPull(octokit, owner, repoName, prNumber)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!pull) return;

    // Bounded poll for a still-computing `mergeable` (issue trap: ordering of
    // events — check_run can fire before GitHub has computed it).
    for (let i = 0; i < 4 && pull.mergeable === null && !pull.merged; i++) {
      yield* Effect.sleep("2 seconds");
      pull = yield* gh
        .getPull(octokit, owner, repoName, prNumber)
        .pipe(Effect.catchAll(() => Effect.succeed(pull!)));
    }

    if (pull.merged) {
      // Already merged (by us on a run we crashed mid-recap, or by a human
      // from the GitHub UI) — nothing left to decide. Clear the arm so a
      // stray later event doesn't keep re-evaluating a closed PR. SHA-scoped:
      // a re-arm on a new push that landed while this evaluation was in
      // flight must not have its fresh arm deleted here (issue trap: stale
      // arm snapshot race).
      yield* Effect.sync(() =>
        mergeArms.disarmIfSha.run({ $repo: repoFullName, $pr: prNumber, $sha: arm.head_sha }),
      );
      return;
    }
    if (pull.headSha !== arm.head_sha) {
      // Should already be gone via the `synchronize` handler; belt-and-braces
      // re-check right before merging (issue trap: race with a new push).
      // SHA-scoped disarm for the same reason as above.
      yield* Effect.sync(() =>
        mergeArms.disarmIfSha.run({ $repo: repoFullName, $pr: prNumber, $sha: arm.head_sha }),
      );
      return;
    }

    const reviewsList = yield* gh
      .listReviews(octokit, owner, repoName, prNumber)
      .pipe(Effect.catchAll(() => Effect.succeed([])));
    // Fail closed: an empty check list would satisfy the CI condition, so an
    // API error here skips this evaluation and waits for the next event.
    const checkData = yield* gh
      .headChecks(octokit, owner, repoName, pull.headSha)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!checkData) {
      log.warn("merge: could not read checks, skipping evaluation", { repo: repoFullName, pr: prNumber });
      return;
    }
    const requiredChecks = yield* gh.branchProtectionRequiredChecks(octokit, owner, repoName, pull.baseRef);
    const botLogin = yield* gh.botLogin().pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    // Pin fouine's reviews to the armed SHA: without this, an APPROVED on an
    // older commit plus green CI on a later re-armed push would merge a
    // commit fouine never actually reviewed (issue trap: approval not pinned
    // to the armed SHA).
    const fouineRaw = reviewsList.filter(
      (r) => r.user && r.user === botLogin && r.commit_id === arm.head_sha,
    );
    const humanReviews: MergeReview[] = reviewsList
      .filter((r) => r.user && r.user !== botLogin)
      .map((r) => ({ user: r.user!, state: r.state, submitted_at: r.submitted_at }));
    const fouineReviews: MergeReview[] = fouineRaw.map((r) => ({
      user: r.user!,
      state: r.state,
      submitted_at: r.submitted_at,
    }));

    const state: MergeState = {
      armedSha: arm.head_sha,
      headSha: pull.headSha,
      draft: pull.draft,
      mergeable: pull.mergeable,
      fouineReviews,
      humanReviews,
      checks: checkData.checks,
      statuses: checkData.statuses,
      requiredChecks,
    };

    const decision = shouldMerge(state);
    if (!decision.ok) {
      log.debug("merge not ready", {
        repo: repoFullName,
        pr: prNumber,
        reason: decision.reason,
        wait: decision.wait,
      });
      return;
    }

    const method = resolveMergeMethod(repo.merge_method);
    const mergeResult = yield* gh.mergePull(octokit, owner, repoName, prNumber, {
      method,
      sha: arm.head_sha,
    });

    let mergeSha: string;
    if (mergeResult.ok) {
      mergeSha = mergeResult.sha;
    } else if (mergeResult.status === 409) {
      yield* gh.createIssueComment(
        octokit,
        owner,
        repoName,
        prNumber,
        "🦡 The PR's head moved right before merging — disarmed. It'll re-arm automatically on the next push.",
      );
      yield* Effect.sync(() =>
        mergeArms.disarmIfSha.run({ $repo: repoFullName, $pr: prNumber, $sha: arm.head_sha }),
      );
      return;
    } else {
      // 405 (method forbidden by the repo) and anything else unexpected get
      // the same treatment: tell the PR why, and drop the arm rather than
      // retry a merge that will fail the same way on every future event.
      yield* gh.createIssueComment(
        octokit,
        owner,
        repoName,
        prNumber,
        `🦡 Merge failed (${mergeResult.status}): ${mergeResult.message}. Disarmed — fix the issue; a new push will re-arm it.`,
      );
      yield* Effect.sync(() =>
        mergeArms.disarmIfSha.run({ $repo: repoFullName, $pr: prNumber, $sha: arm.head_sha }),
      );
      return;
    }

    // The review that cleared the gate — decision.ok guarantees one exists.
    const approving = fouineRaw
      .filter((r) => r.state !== "PENDING")
      .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
      .at(-1)!;

    const allFindings = yield* Effect.sync(() =>
      findings.byRepoPR.all({ $repo: repoFullName, $pr: prNumber }),
    );
    const allReviews = yield* Effect.sync(() =>
      reviews.byRepoPR.all({ $repo: repoFullName, $pr: prNumber, $limit: 500 }),
    );
    const passingChecks = requiredChecks
      ? state.checks.filter((c) => requiredChecks.includes(c.name))
      : state.checks;

    const recap = renderRecap({
      method,
      mergeSha,
      approvingReviewUrl: approving.html_url,
      approvingReviewSummary: approving.body.split("\n")[0] ?? "",
      findingsCount: allFindings.filter((f) => f.kind === "inline").length,
      pushesCount: allReviews.length,
      checksPassed: passingChecks.length,
      checksMode: requiredChecks ? "required checks" : "all checks",
      fixerCommits: [], // ponytail: no fixer yet (#12) — render the line once it exists
      totalCost: allReviews.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    });

    // No edit-in-place branch here: idempotency against a retried evaluation
    // rests on the `pull.merged` early-return above, so a post-merge retry
    // never reaches this line again.
    yield* gh.createIssueComment(octokit, owner, repoName, prNumber, recap);
    yield* Effect.sync(() =>
      mergeArms.disarmIfSha.run({ $repo: repoFullName, $pr: prNumber, $sha: arm.head_sha }),
    );
  });
}
