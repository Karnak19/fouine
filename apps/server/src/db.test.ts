import { test, expect } from "bun:test";
import { db, repos, reviews, settings, settingValue, findings, type StatsFilter } from "~/db";

test("upsert then get a repo", () => {
  repos.upsert.run({
    $full_name: "acme/get",
    $installation_id: 123,
    $prompt: null,
    $model: null,
  });
  const got = repos.get.get({ $full_name: "acme/get" });
  expect(got?.full_name).toBe("acme/get");
  expect(got?.installation_id).toBe(123);
  // Opt-in: a repo the App just discovered is disabled until enabled in the UI.
  expect(got?.enabled).toBe(0);
});

test("upsert does not clobber a dashboard-edited prompt/model", () => {
  const full = "acme/clobber";
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: full,
    $prompt: "focus on perf",
    $model: "opencode-go/glm-5.1",
    $enabled: 0,
    $deny_test_commands: 1,
  });

  // A subsequent webhook re-upserts the repo: installation_id updates, but the
  // dashboard prompt/model overrides must survive.
  repos.upsert.run({ $full_name: full, $installation_id: 2, $prompt: null, $model: null });
  const got = repos.get.get({ $full_name: full });
  expect(got?.installation_id).toBe(2);
  expect(got?.prompt).toBe("focus on perf");
  expect(got?.model).toBe("opencode-go/glm-5.1");
  expect(got?.enabled).toBe(0);
});

test("review lifecycle: pending -> running -> completed", () => {
  const full = "acme/lifecycle";
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });

  const row = reviews.insert.get({
    $repo: full,
    $pr: 7,
    $title: "Test PR",
    $session: null,
    $status: "pending",
    $trigger: "opened",
  })!;
  expect(row.status).toBe("pending");
  expect(row.trigger).toBe("opened");
  // Null until the GitHub check run exists; the orphan reaper skips rows without one.
  expect(row.check_run_id).toBeNull();

  reviews.updateStatus.run({ $status: "running", $done: 0, $id: row.id });
  reviews.setSession.run({ $session: "sess-1", $id: row.id });
  reviews.setCheckRun.run({ $check: 9911, $id: row.id });
  // Success path is a single atomic write (status + completed_at + cost + tokens),
  // so a crash mid-completion can't split a "completed" row from its cost.
  reviews.complete.run({
    $id: row.id,
    $cost: 0.0123,
    $tokens: 4096,
    $model: "anthropic/claude-opus-4",
    $patch: "p-lifecycle",
  });

  const recent = reviews.recent.all({
    $from: null, $to: null,
    $repo: null,
    $model: null,
    $status: null,
    $limit: 10,
  });
  const target = recent.find((r) => r.id === row.id);
  expect(target?.status).toBe("completed");
  expect(target?.session_id).toBe("sess-1");
  expect(target?.completed_at).not.toBeNull();
  expect(target?.cost).toBeCloseTo(0.0123);
  expect(target?.tokens).toBe(4096);
  expect(target?.model).toBe("anthropic/claude-opus-4");
  expect(target?.check_run_id).toBe(9911);
  // The diff identity a later rebase-only push will match against.
  expect(target?.patch_id).toBe("p-lifecycle");
});

test("byRepoPR returns only that PR's reviews, newest first", () => {
  const full = "acme/bypr";
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });

  const a = reviews.insert.get({
    $repo: full,
    $pr: 11,
    $title: "A",
    $session: null,
    $status: "completed",
    $trigger: "opened",
  })!;
  reviews.insert.get({
    $repo: full,
    $pr: 12,
    $title: "B",
    $session: null,
    $status: "completed",
    $trigger: "synchronize",
  })!;
  const a2 = reviews.insert.get({
    $repo: full,
    $pr: 11,
    $title: "A",
    $session: null,
    $status: "completed",
    $trigger: "retry",
  })!;

  const got = reviews.byRepoPR.all({ $repo: full, $pr: 11, $limit: 50 });
  expect(got.map((r) => r.id)).toEqual([a2.id, a.id]);
  expect(got.every((r) => r.pr_number === 11)).toBe(true);
});

// Filtered stats. Distinctive repo/model names so rows other tests write into
// the same temp DB can't drift these assertions.
const NOW = Math.floor(Date.now() / 1000);
const OLD = NOW - 100 * 86400;
// Direct insert: created_at defaults to now, and these need controlled dates.
const seedReview = db.prepare<{ id: number }, [string, string, number, number]>(
  `INSERT INTO reviews
     (repo_full_name, pr_number, status, trigger, cost, tokens, model, created_at, completed_at)
   VALUES (?1, 1, 'completed', 'opened', 1.0, 100, ?2, ?3, ?4)
   RETURNING id`,
);

// A finding is written after its review runs, so its own created_at can fall
// outside the window the review sits in. bySeverity must follow the review, or
// a review counted by every other panel loses its findings from this one.
test("bySeverity follows the review's date, not the finding's", () => {
  repos.upsert.run({ $full_name: "sev/lag", $installation_id: 1, $prompt: null, $model: null });
  const inWindow = seedReview.get("sev/lag", "sev-model", NOW - 3600, NOW - 3000)!;
  // Finding recorded a long time after the review — well outside a 24h window.
  db.prepare(
    `INSERT INTO findings (review_id, repo_full_name, pr_number, kind, severity, body, created_at)
     VALUES (?1, 'sev/lag', 1, 'inline', 'blocking', 'x', ?2)`,
  ).run(inWindow.id, NOW + 40 * 86400);

  const within = findings.bySeverity.all({
    $from: NOW - 86400, $to: null,
    $repo: "sev/lag",
    $model: null,
  });
  expect(within).toEqual([{ severity: "blocking", count: 1 }]);

  // And the review being outside the window still excludes it.
  const older = seedReview.get("sev/lag", "sev-model", OLD, OLD + 60)!;
  db.prepare(
    `INSERT INTO findings (review_id, repo_full_name, pr_number, kind, severity, body, created_at)
     VALUES (?1, 'sev/lag', 1, 'inline', 'nit', 'x', ?2)`,
  ).run(older.id, NOW);
  expect(
    findings.bySeverity.all({ $from: NOW - 86400, $to: null, $repo: "sev/lag", $model: null }),
  ).toEqual([{ severity: "blocking", count: 1 }]);
});

// The $to bound is exclusive, so an inclusive "to the 14th" is the epoch of the
// 15th. A review created late on the 14th must still count — getting this wrong
// drops the most recent day, which is the one usually being looked at.
test("$to is an exclusive bound, so the whole 'to' day counts", () => {
  repos.upsert.run({ $full_name: "win/dow", $installation_id: 1, $prompt: null, $model: null });
  const day = Math.floor(NOW / 86400) * 86400; // midnight UTC of NOW's day
  const lateThatDay = day + 86400 - 1; // 23:59:59
  seedReview.get("win/dow", "win-model", lateThatDay, lateThatDay + 5)!;

  const base = { $repo: "win/dow", $model: null };
  // to = that day, passed as the start of the next -> the 23:59:59 row counts.
  expect(
    reviews.byProject.all({ ...base, $from: null, $to: day + 86400 })[0]?.reviews,
  ).toBe(1);
  // The naive off-by-one (<= the day's own midnight) would have dropped it.
  expect(reviews.byProject.all({ ...base, $from: null, $to: day })).toHaveLength(0);

  // from-only: from that midnight onward includes it.
  expect(reviews.byProject.all({ ...base, $from: day, $to: null })[0]?.reviews).toBe(1);
  // to-only: everything before the next midnight includes it.
  expect(
    reviews.byProject.all({ ...base, $from: null, $to: day + 86400 })[0]?.reviews,
  ).toBe(1);
  // Both bounds around the day.
  expect(
    reviews.byProject.all({ ...base, $from: day, $to: day + 86400 })[0]?.reviews,
  ).toBe(1);
  // An inverted window that reaches the DB simply returns nothing, no error.
  expect(reviews.byProject.all({ ...base, $from: day + 86400, $to: day })).toHaveLength(0);
  expect(reviews.daily.all({ ...base, $from: day + 86400, $to: day })).toHaveLength(0);
});

// The four chart panels. Seeded on their own repo so other tests' rows can't
// drift the counts.
test("chart queries: outcomes, latency samples, findings per day, top files", () => {
  repos.upsert.run({ $full_name: "chart/one", $installation_id: 1, $prompt: null, $model: null });
  const day = Math.floor(NOW / 86400) * 86400;
  const at = (offset: number) => day + offset;

  // 2 completed (durations 60s and 300s), 1 failed, 1 still running — all on the
  // same UTC day, so they land in one bucket.
  const c1 = seedReview.get("chart/one", "chart-model", at(3600), at(3660))!;
  const c2 = seedReview.get("chart/one", "chart-model", at(7200), at(7500))!;
  db.prepare(
    `INSERT INTO reviews (repo_full_name, pr_number, status, trigger, model, created_at, completed_at)
     VALUES ('chart/one', 2, 'failed', 'opened', 'chart-model', ?1, ?2),
            ('chart/one', 3, 'running', 'opened', 'chart-model', ?1, NULL)`,
  ).run(at(10800), at(10900));

  for (const [review, sev, path] of [
    [c1.id, "blocking", "src/a.ts"],
    [c1.id, "nit", "src/a.ts"],
    [c2.id, "nit", "src/b.ts"],
  ] as const)
    db.prepare(
      `INSERT INTO findings (review_id, repo_full_name, pr_number, kind, severity, path, body)
       VALUES (?1, 'chart/one', 1, 'inline', ?2, ?3, 'x')`,
    ).run(review, sev, path);
  // A summary row has no path and no severity: it must not reach either panel.
  db.prepare(
    `INSERT INTO findings (review_id, repo_full_name, pr_number, kind, severity, path, body)
     VALUES (?1, 'chart/one', 1, 'summary', NULL, NULL, 'summary')`,
  ).run(c1.id);

  const scope = { $from: day, $to: day + 86400, $repo: "chart/one", $model: null };

  const rel = reviews.reliabilityDaily.all(scope);
  expect(rel).toHaveLength(1);
  expect(rel[0]).toMatchObject({ completed: 2, failed: 1, in_flight: 1 });

  const samples = reviews.latencySamples.all(scope);
  expect(samples.map((s) => s.seconds).toSorted((a, b) => a - b)).toEqual([60, 300]);

  const daily = findings.dailyBySeverity.all(scope);
  expect(daily.reduce((s, r) => s + r.count, 0)).toBe(3); // summary row excluded
  expect(daily.find((r) => r.severity === "nit")?.count).toBe(2);

  const files = findings.topFiles.all(scope);
  expect(files).toEqual([
    { path: "src/a.ts", count: 2 },
    { path: "src/b.ts", count: 1 },
  ]);

  // The model guard reaches findings through the join, not their own columns.
  expect(findings.topFiles.all({ ...scope, $model: "chart-model" })).toHaveLength(2);
  expect(findings.topFiles.all({ ...scope, $model: "nope" })).toHaveLength(0);

  // An empty window is normal: every panel returns nothing, nothing throws.
  const empty = { $from: NOW + 86400, $to: NOW + 2 * 86400, $repo: null, $model: null };
  expect(reviews.reliabilityDaily.all(empty)).toEqual([]);
  expect(reviews.latencySamples.all(empty)).toEqual([]);
  expect(findings.dailyBySeverity.all(empty)).toEqual([]);
  expect(findings.topFiles.all(empty)).toEqual([]);
});

// Findings are written after their review, so both findings panels must scope by
// the review's date — the same rule bySeverity needed.
test("chart findings panels follow the review's date, not the finding's", () => {
  repos.upsert.run({ $full_name: "chart/lag", $installation_id: 1, $prompt: null, $model: null });
  const r = seedReview.get("chart/lag", "lag-model", NOW - 3600, NOW - 3000)!;
  db.prepare(
    `INSERT INTO findings (review_id, repo_full_name, pr_number, kind, severity, path, body, created_at)
     VALUES (?1, 'chart/lag', 1, 'inline', 'blocking', 'src/lag.ts', 'x', ?2)`,
  ).run(r.id, NOW + 40 * 86400); // recorded long after the review

  const scope = { $from: NOW - 86400, $to: null, $repo: "chart/lag", $model: null };
  expect(findings.topFiles.all(scope)).toEqual([{ path: "src/lag.ts", count: 1 }]);
  expect(findings.dailyBySeverity.all(scope).reduce((s, x) => s + x.count, 0)).toBe(1);
});

test("stats filters narrow by repo, model and date", () => {
  for (const r of ["filt/alpha", "filt/beta"])
    repos.upsert.run({ $full_name: r, $installation_id: 1, $prompt: null, $model: null });

  const a = seedReview.get("filt/alpha", "filt-model-a", NOW, NOW + 10)!;
  const b = seedReview.get("filt/beta", "filt-model-b", NOW, NOW + 20)!;
  const old = seedReview.get("filt/alpha", "filt-model-b", OLD, OLD + 30)!;

  for (const [review, repo, sev] of [
    [a.id, "filt/alpha", "blocking"],
    [b.id, "filt/beta", "nit"],
    [old.id, "filt/alpha", "nit"],
  ] as const)
    findings.insert.run({
      $review: review,
      $repo: repo,
      $pr: 1,
      $kind: "inline",
      $severity: sev,
      $event: null,
      $path: null,
      $line: null,
      $body: "x",
      $github_review_id: null,
      $github_comment_id: null,
    });

  const none = { $from: null, $to: null, $repo: null, $model: null };

  // Repo filter narrows byProject to that one row, and daily to its rows.
  const byProject = reviews.byProject.all({ ...none, $repo: "filt/beta" });
  expect(byProject.map((r) => r.repo_full_name)).toEqual(["filt/beta"]);
  expect(byProject[0]?.reviews).toBe(1);
  expect(reviews.daily.all({ ...none, $repo: "filt/beta" })).toHaveLength(1);
  expect(reviews.daily.all({ ...none, $repo: "filt/alpha" })).toHaveLength(2); // NOW + OLD days

  // Model filter narrows byModel and (through the join) bySeverity.
  const byModel = reviews.byModel.all({ ...none, $model: "filt-model-b" });
  expect(byModel.map((m) => m.model)).toEqual(["filt-model-b"]);
  expect(byModel[0]?.reviews).toBe(2);
  const sev = findings.bySeverity.all({ ...none, $model: "filt-model-b" });
  expect(sev).toEqual([{ severity: "nit", count: 2 }]);

  // $from cutoff drops the 100-day-old row.
  const recent = reviews.byProject.all({ ...none, $from: NOW - 86400, $to: null, $repo: "filt/alpha" });
  expect(recent[0]?.reviews).toBe(1);
  expect(reviews.daily.all({ ...none, $from: NOW - 86400, $to: null, $repo: "filt/alpha" })).toHaveLength(1);

  // All-null params see everything, old rows included.
  expect(reviews.byProject.all(none).find((r) => r.repo_full_name === "filt/alpha")?.reviews).toBe(2);
  expect(reviews.latencyAgg.get(none)!.count).toBeGreaterThan(0);
  expect(reviews.latencyP95.get(none)?.d).not.toBeUndefined();
  expect(reviews.triggers.all(none).length).toBeGreaterThan(0);
  expect(reviews.topCost.all(none).length).toBeGreaterThan(0);
  expect(
    reviews.recent.all({ ...none, $status: "completed", $limit: 5 }).every((r) => r.status === "completed"),
  ).toBe(true);

  // The model dropdown must not shrink when a filter is applied: it takes no
  // params, so every model stays listed however narrow the current view is.
  const all = reviews.allModels.all().map((m) => m.model);
  expect(all).toContain("filt-model-a");
  expect(all).toContain("filt-model-b");
  expect(all).toEqual([...all].sort());
});

test("settings get/set and settingValue helper", () => {
  const key = "test_setting_key";
  expect(settingValue(key)).toBeUndefined();
  settings.set.run({ $key: key, $value: "v1" });
  expect(settingValue(key)).toBe("v1");
  settings.set.run({ $key: key, $value: "v2" });
  expect(settingValue(key)).toBe("v2");
});

// ── #78: `skipped` rows are bookkeeping, not outcomes ────────────────────────
// Every aggregate must report exactly what it reported before the skips existed.
// The tests share one DB, so the global aggregates (daily, triggers, latency,
// topCost, unfinished, reliability, latency samples) are snapshotted before the
// skipped rows go in and asserted unchanged after — the only robust way to pin
// them here.

// Every stats statement takes the dashboard's filter params. "No filter at all"
// is the widest possible population, which is exactly the case where a leaked
// skipped row would show up.
const NO_FILTER: StatsFilter = { $from: null, $to: null, $repo: null, $model: null };

// Backdating matters more than it looks. Every row seeded "now" lands in the
// same day bucket, so a leaked skip hides inside a day group that already
// exists — reliabilityDaily's guard could be deleted and every assertion would
// still pass. A skip on a day of its own is what actually exercises the guard.
const backdate = db.prepare<null, { $shift: number; $id: number }>(
  `UPDATE reviews SET created_at = created_at - $shift,
     completed_at = completed_at - $shift
   WHERE id = $id`,
);

const seed = (
  full: string,
  pr: number,
  status: string,
  extra: {
    cost?: number;
    tokens?: number;
    model?: string;
    patch?: string;
    trigger?: string;
    daysAgo?: number;
  } = {},
) => {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  const row = reviews.insert.get({
    $repo: full,
    $pr: pr,
    $title: "t",
    $session: null,
    $status: "pending",
    $trigger: extra.trigger ?? "synchronize",
  })!;
  if (status === "completed")
    reviews.complete.run({
      $id: row.id,
      $cost: extra.cost ?? 0,
      $tokens: extra.tokens ?? 0,
      $model: extra.model ?? null,
      $patch: extra.patch ?? null,
    });
  if (status === "failed") reviews.fail.run({ $id: row.id, $error: "boom" });
  if (status === "skipped") reviews.skip.run({ $id: row.id, $patch: extra.patch ?? null });
  if (extra.daysAgo) backdate.run({ $shift: extra.daysAgo * 86400, $id: row.id });
  return row.id;
};

test("skipped rows are excluded from every aggregate", () => {
  const full = "acme/skipagg";
  const model = "acme/skipmodel";

  seed(full, 1, "completed", { cost: 1, tokens: 100, model });
  seed(full, 2, "completed", { cost: 2, tokens: 200, model });
  seed(full, 3, "failed");

  const project = () => reviews.byProject.all(NO_FILTER).find((r) => r.repo_full_name === full);
  const modelRow = () => reviews.byModel.all(NO_FILTER).find((r) => r.model === model);
  const before = {
    project: project(),
    model: modelRow(),
    daily: reviews.daily.all(NO_FILTER),
    triggers: reviews.triggers.all(NO_FILTER),
    latency: reviews.latencyAgg.get(NO_FILTER),
    p95: reviews.latencyP95.get(NO_FILTER)?.d ?? null,
    topCost: reviews.topCost.all(NO_FILTER),
    unfinished: reviews.unfinished.all().length,
    reviewedPRs: reviews.reviewedPRsSince.all({ $repo: full, $since: 0 }).map((r) => r.pr_number),
    // #73's panels. reliabilityDaily is the one a skip would have quietly
    // polluted: it would conjure all-zero day rows, and it is one bare COUNT(*)
    // away from having its success-rate denominator inflated.
    reliability: reviews.reliabilityDaily.all(NO_FILTER),
    latencySamples: reviews.latencySamples.all(NO_FILTER).length,
    allModels: reviews.allModels.all().map((r) => r.model),
    // #73's findings panels join reviews for the filter guards. A skipped review
    // posts nothing, so it can carry no findings — assert it rather than assume.
    severity: findings.bySeverity.all(NO_FILTER),
    dailySeverity: findings.dailyBySeverity.all(NO_FILTER),
    topFiles: findings.topFiles.all(NO_FILTER),
  };
  // 3 rows exist, one of them failed — the failure still counts as an outcome.
  expect(before.project).toMatchObject({ reviews: 3, cost: 3, tokens: 300 });
  expect(before.model).toMatchObject({ reviews: 2, cost: 3, tokens: 300 });
  expect(before.reviewedPRs.sort()).toEqual([1, 2]);

  // Now the skips. A skip is terminal and cheap; it must move nothing.
  seed(full, 1, "skipped", { patch: "p1" });
  seed(full, 2, "skipped", { patch: "p2" });
  seed(full, 4, "skipped", { patch: "p3", trigger: "opened" });
  // On a day of its own, where no real review exists — the only shape that can
  // catch a per-day aggregate leaking a skip into a bucket that should not exist.
  seed(full, 5, "skipped", { patch: "p4", daysAgo: 9 });

  expect(project()).toEqual(before.project!);
  expect(modelRow()).toEqual(before.model!);
  expect(reviews.daily.all(NO_FILTER)).toEqual(before.daily);
  expect(reviews.triggers.all(NO_FILTER)).toEqual(before.triggers);
  expect(reviews.latencyAgg.get(NO_FILTER)).toEqual(before.latency!);
  expect(reviews.latencyP95.get(NO_FILTER)?.d ?? null).toEqual(before.p95);
  expect(reviews.topCost.all(NO_FILTER)).toEqual(before.topCost);
  expect(reviews.reliabilityDaily.all(NO_FILTER)).toEqual(before.reliability);
  expect(reviews.latencySamples.all(NO_FILTER).length).toBe(before.latencySamples);
  expect(reviews.allModels.all().map((r) => r.model)).toEqual(before.allModels);
  // Terminal: the boot reaper must never see a skip as in-flight.
  expect(reviews.unfinished.all().length).toBe(before.unfinished);
  // A skip must never make the improver think a PR was reviewed.
  expect(reviews.reviewedPRsSince.all({ $repo: full, $since: 0 }).map((r) => r.pr_number).sort()).toEqual(
    before.reviewedPRs.sort(),
  );

  // The guards on byModel/topCost/allModels are redundant *today* — they lean on
  // a skipped row having no model and no cost. That invariant is what actually
  // keeps those three panels clean, so pin it here; the guards are what keep them
  // clean if it ever stops holding.
  for (const r of reviews.byRepo.all({ $repo: full, $limit: 50 }).filter((x) => x.status === "skipped")) {
    expect(r.cost).toBeNull();
    expect(r.tokens).toBeNull();
    expect(r.model).toBeNull();
    expect(r.completed_at).not.toBeNull(); // terminal, never in-flight
  }

  expect(findings.bySeverity.all(NO_FILTER)).toEqual(before.severity);
  expect(findings.dailyBySeverity.all(NO_FILTER)).toEqual(before.dailySeverity);
  expect(findings.topFiles.all(NO_FILTER)).toEqual(before.topFiles);

  // But the skip is still visible in the list views — that's deliberate.
  expect(reviews.byRepoPR.all({ $repo: full, $pr: 1, $limit: 50 }).map((r) => r.status)).toContain(
    "skipped",
  );
  // And the stats page's status filter can select them, so the saving is
  // inspectable rather than merely absent from every chart.
  const skippedOnly = reviews.recent.all({
    ...NO_FILTER,
    $repo: full,
    $status: "skipped",
    $limit: 50,
  });
  expect(skippedOnly.length).toBe(4);
  expect(skippedOnly.map((r) => r.patch_id).sort()).toEqual(["p1", "p2", "p3", "p4"]);
});

test("lastReviewedPatch: newest completed row with a patch_id, nothing else", () => {
  const full = "acme/baseline";
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })).toBeNull();

  const old = seed(full, 5, "completed", { patch: "old" });
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })).toMatchObject({
    id: old,
    patch_id: "old",
  });

  // Newest wins.
  const fresh = seed(full, 5, "completed", { patch: "fresh" });
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })?.id).toBe(fresh);

  // Trap 2: a failed run must never become a baseline, so the last *good* one
  // stays the answer — a rebase after a failure is re-reviewed.
  seed(full, 5, "failed", { patch: "never" });
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })?.id).toBe(fresh);

  // A skip is not a review either.
  seed(full, 5, "skipped", { patch: "skip" });
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })?.id).toBe(fresh);

  // Completed but with no patch id (pre-column row, or the helper bailed).
  seed(full, 5, "completed", {});
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 5 })?.id).toBe(fresh);

  // Another PR's baseline never leaks across.
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 6 })).toBeNull();
  // Trap 6: improver runs are stored with pr_number = 0 and must never shadow.
  seed(full, 0, "completed", { patch: "improver" });
  expect(reviews.lastReviewedPatch.get({ $repo: full, $pr: 0 })).toBeNull();
});
