import { test, expect } from "bun:test";
import { db, repos, reviews, settings, settingValue, findings } from "~/db";

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
  reviews.complete.run({ $id: row.id, $cost: 0.0123, $tokens: 4096, $model: "anthropic/claude-opus-4" });

  const recent = reviews.recent.all({
    $from: null,
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

  const none = { $from: null, $repo: null, $model: null };

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
  const recent = reviews.byProject.all({ ...none, $from: NOW - 86400, $repo: "filt/alpha" });
  expect(recent[0]?.reviews).toBe(1);
  expect(reviews.daily.all({ ...none, $from: NOW - 86400, $repo: "filt/alpha" })).toHaveLength(1);

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
