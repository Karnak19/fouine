import { test, expect } from "bun:test";
import { repos, reviews, settings, settingValue } from "~/db";

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
  })!;
  expect(row.status).toBe("pending");

  reviews.updateStatus.run({ $status: "running", $done: 0, $id: row.id });
  reviews.setSession.run({ $session: "sess-1", $id: row.id });
  reviews.updateStatus.run({ $status: "completed", $done: 1, $id: row.id });

  const recent = reviews.recent.all({ $limit: 10 });
  const target = recent.find((r) => r.id === row.id);
  expect(target?.status).toBe("completed");
  expect(target?.session_id).toBe("sess-1");
  expect(target?.completed_at).not.toBeNull();
});

test("settings get/set and settingValue helper", () => {
  const key = "test_setting_key";
  expect(settingValue(key)).toBeUndefined();
  settings.set.run({ $key: key, $value: "v1" });
  expect(settingValue(key)).toBe("v1");
  settings.set.run({ $key: key, $value: "v2" });
  expect(settingValue(key)).toBe("v2");
});
