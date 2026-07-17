import { repos, reviews, settings, settingValue } from "~/db";
import { runImprove } from "~/review/runner";
import { log } from "~/server/log";

// The outer self-improvement loop's scheduler. Once a day per enabled repo (if
// there is anything new to learn from), run the improver agent over the PRs
// fouine reviewed since the last pass. The per-repo marker lives in settings,
// and only advances on success, so a failed pass is retried on the next sweep.
const DAY = 24 * 60 * 60;

const markerKey = (repo: string) => `improver_last_run:${repo}`;

export interface ImproveOutcome {
  started: boolean;
  reason?: string;
}

// force=true (manual dashboard trigger) skips the once-a-day gate AND the
// marker: it re-reads the most recent completed reviews even if a prior run
// already covered them. That's the recovery path when a run "completed" but
// its proposal never landed (e.g. propose_review_notes failed on missing
// contents:write) — the marker has advanced, so only force can revisit those
// threads. Re-reading is harmless: the agent rewrites REVIEW.md as a whole.
export async function runImproverForRepo(fullName: string, force = false): Promise<ImproveOutcome> {
  const repo = repos.get.get({ $full_name: fullName });
  if (!repo) return { started: false, reason: "unknown repo" };
  if (!repo.enabled) return { started: false, reason: "repo disabled" };

  const now = Math.floor(Date.now() / 1000);
  const lastRun = Number(settingValue(markerKey(fullName)) ?? 0);
  if (!force && now - lastRun < DAY) return { started: false, reason: "ran within the last day" };

  const prNumbers = reviews.reviewedPRsSince
    .all({ $repo: fullName, $since: force ? 0 : lastRun })
    .map((r) => r.pr_number);
  if (!prNumbers.length) return { started: false, reason: "no new completed reviews" };

  log.info("improver queued", { repo: fullName, prs: prNumbers, force });
  await runImprove({ repoFullName: fullName, installationId: repo.installation_id, prNumbers });
  // Reached only when the pipeline didn't propagate a failure — advance the
  // marker so these threads aren't re-read next sweep.
  settings.set.run({ $key: markerKey(fullName), $value: String(now) });
  return { started: true };
}

// Hourly sweep (started from boot): cheap no-op for every repo that already ran
// today or has nothing new, so it's safe to call often and robust to restarts.
export async function runImproverSweep(): Promise<void> {
  for (const repo of repos.list.all()) {
    if (!repo.enabled) continue;
    try {
      await runImproverForRepo(repo.full_name);
    } catch (err) {
      log.error("improver sweep failed for repo", {
        repo: repo.full_name,
        error: String((err as Error)?.message ?? err),
      });
    }
  }
}
