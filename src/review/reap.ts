import { repos, reviews, type ReviewRow } from "~/db";
import { CHECK_NAME } from "~/effect/github";
import { getInstallationOctokit } from "~/github";
import { publishReviewEvent } from "~/server/events";
import { log } from "~/server/log";

export const REAP_MESSAGE = "Interrupted by server restart";

// A review only lives in memory (see activeReviews in runner.ts), so any row
// still at pending/running when we boot is an orphan from a crash, a deploy, or
// a kill — nothing will ever finish it. Left alone it sits under "RUNNING NOW"
// forever (#60). Mark them failed here, then best-effort close the GitHub check
// runs they left in_progress.
//
// Order matters: the DB write comes first and never depends on GitHub. A
// deleted repo, a revoked installation token or a network blip must not block
// boot or leave the row lying about its status.
export async function reapOrphanReviews(): Promise<void> {
  let orphans: ReviewRow[];
  try {
    orphans = reviews.unfinished.all();
  } catch (err) {
    log.error("orphan reap: could not read unfinished reviews", { error: String(err) });
    return;
  }
  if (!orphans.length) return;

  const reaped: ReviewRow[] = [];
  for (const row of orphans) {
    try {
      reviews.fail.run({ $id: row.id, $error: REAP_MESSAGE });
      publishReviewEvent("updated", row.id);
      reaped.push(row);
    } catch (err) {
      log.error("orphan reap: failed to mark review failed", {
        review: row.id,
        error: String(err),
      });
    }
  }
  log.info("orphan reviews reaped", {
    count: reaped.length,
    reviews: reaped.map((r) => r.id),
  });

  // Best-effort from here on — every failure is logged and swallowed.
  for (const row of reaped) {
    if (row.pr_number <= 0) continue; // improver runs open no check
    try {
      await closeOrphanCheck(row);
    } catch (err) {
      log.warn("orphan reap: could not close check run", {
        review: row.id,
        repo: row.repo_full_name,
        error: String(err),
      });
    }
  }
}

// We don't persist the check run id, so we find it the way GitHub lets us: look
// up the PR's current head sha and complete any in_progress check of ours on it.
async function closeOrphanCheck(row: ReviewRow): Promise<void> {
  const repo = repos.get.get({ $full_name: row.repo_full_name });
  if (!repo) return;
  const [owner, name] = row.repo_full_name.split("/");
  const octokit = await getInstallationOctokit(repo.installation_id);

  const pr = await octokit.rest.pulls.get({ owner, repo: name, pull_number: row.pr_number });
  const runs = await octokit.rest.checks.listForRef({
    owner,
    repo: name,
    ref: pr.data.head.sha,
    check_name: CHECK_NAME,
    status: "in_progress",
  });

  for (const check of runs.data.check_runs) {
    await octokit.rest.checks.update({
      owner,
      repo: name,
      check_run_id: check.id,
      status: "completed",
      conclusion: "failure",
      completed_at: new Date().toISOString(),
      output: { title: "Review failed", summary: REAP_MESSAGE },
    });
    log.info("orphan check run closed", {
      review: row.id,
      repo: row.repo_full_name,
      check: check.id,
    });
  }
}
