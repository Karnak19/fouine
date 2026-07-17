import { expect, test, mock } from "bun:test";
import { db, repos, reviews, settingValue } from "~/db";
import type { ImproveTarget } from "~/effect/improve";

// Stub the runner so gating tests never touch git/opencode. Must be registered
// before importing the module under test.
const runImprove = mock((_target: ImproveTarget) => Promise.resolve());
mock.module("~/review/runner", () => ({ runImprove }));
const { runImproverForRepo } = await import("~/review/improver");

const FULL = "acme/improver";

function seedRepo(enabled = 1) {
  repos.upsert.run({ $full_name: FULL, $installation_id: 5, $prompt: null, $model: null });
  repos.update.run({ $full_name: FULL, $prompt: null, $model: null, $enabled: enabled });
}

// agoSeconds backdates created_at: the marker and unixepoch() share second
// granularity, and the work-list query is strictly `created_at > marker`, so
// rows seeded "in the past" must actually be in the past.
function seedCompletedReview(pr: number, agoSeconds = 0, repo = FULL) {
  const row = reviews.insert.get({
    $repo: repo,
    $pr: pr,
    $title: "t",
    $session: null,
    $status: "pending",
    $trigger: "opened",
  })!;
  reviews.complete.run({ $id: row.id, $cost: 0, $tokens: 0, $model: "m" });
  if (agoSeconds) {
    db.exec(`UPDATE reviews SET created_at = created_at - ${agoSeconds} WHERE id = ${row.id}`);
  }
  return row.id;
}

test("improver gating: runs on fresh feedback, then once a day, never without reviews", async () => {
  seedRepo();

  // No completed reviews yet → nothing to learn from.
  expect(await runImproverForRepo(FULL)).toEqual({
    started: false,
    reason: "no new completed reviews",
  });

  seedCompletedReview(11, 100);
  seedCompletedReview(12, 100);
  expect((await runImproverForRepo(FULL)).started).toBe(true);
  expect(runImprove).toHaveBeenCalledTimes(1);
  expect(runImprove.mock.calls[0]?.[0]).toEqual({
    repoFullName: FULL,
    installationId: 5,
    prNumbers: expect.arrayContaining([11, 12]),
  });
  // Success advanced the marker...
  const marker = Number(settingValue(`improver_last_run:${FULL}`));
  expect(marker).toBeGreaterThan(0);

  // ...so a second pass the same day is gated, even with new reviews.
  seedCompletedReview(13);
  expect(await runImproverForRepo(FULL)).toEqual({
    started: false,
    reason: "ran within the last day",
  });

  // force (manual trigger) skips the day gate AND the marker — it re-reads the
  // recent threads (recovery path when a completed run's proposal never landed).
  expect((await runImproverForRepo(FULL, true)).started).toBe(true);
  expect(runImprove).toHaveBeenCalledTimes(2);
  expect(runImprove.mock.calls[1]?.[0]?.prNumbers?.sort()).toEqual([11, 12, 13]);
});

test("improver gating: failed run does not advance the marker", async () => {
  const full = "acme/improver-fail";
  repos.upsert.run({ $full_name: full, $installation_id: 5, $prompt: null, $model: null });
  repos.update.run({ $full_name: full, $prompt: null, $model: null, $enabled: 1 });
  const row = reviews.insert.get({
    $repo: full,
    $pr: 1,
    $title: "t",
    $session: null,
    $status: "pending",
    $trigger: "opened",
  })!;
  reviews.complete.run({ $id: row.id, $cost: 0, $tokens: 0, $model: "m" });

  runImprove.mockRejectedValueOnce(new Error("boom"));
  await expect(runImproverForRepo(full)).rejects.toThrow("boom");
  expect(settingValue(`improver_last_run:${full}`)).toBeUndefined();

  // Next sweep retries the same threads.
  runImprove.mockResolvedValueOnce(undefined);
  expect((await runImproverForRepo(full)).started).toBe(true);
});

test("improver gating: disabled repo never runs", async () => {
  const full = "acme/improver-disabled";
  repos.upsert.run({ $full_name: full, $installation_id: 5, $prompt: null, $model: null });
  expect(await runImproverForRepo(full)).toEqual({ started: false, reason: "repo disabled" });
  expect(await runImproverForRepo("nope/nope")).toEqual({
    started: false,
    reason: "unknown repo",
  });
});
