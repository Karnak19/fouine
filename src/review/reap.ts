import { repos, reviews, type ReviewRow } from "~/db";
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
    // No stored check run id: either the row predates the column or it died
    // before the check was created. Nothing of ours is in progress — skip.
    if (row.check_run_id == null) continue;
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

// The check run id is recorded on the row at creation time, so we close exactly
// the run this review opened. Rediscovering it from the PR's current head would
// be wrong: a commit pushed after the crash moves the head, and we'd close the
// newer review's check instead.
async function closeOrphanCheck(row: ReviewRow): Promise<void> {
  const checkRunId = row.check_run_id;
  if (checkRunId == null) return;
  const repo = repos.get.get({ $full_name: row.repo_full_name });
  if (!repo) return;
  const [owner, name] = row.repo_full_name.split("/");
  const octokit = await getInstallationOctokit(repo.installation_id);

  await octokit.rest.checks.update({
    owner,
    repo: name,
    check_run_id: checkRunId,
    status: "completed",
    conclusion: "failure",
    completed_at: new Date().toISOString(),
    output: { title: "Review failed", summary: REAP_MESSAGE },
  });
  log.info("orphan check run closed", {
    review: row.id,
    repo: row.repo_full_name,
    check: checkRunId,
  });
}
