import { test, expect } from "bun:test";
import { repos, reviews } from "~/db";
import { settings } from "~/db";
import { SETTINGS } from "~/settings";
import {
  delegateTask,
  listRepos,
  MAX_TASKS_PER_REQUEST,
  MAX_TASK_PROMPT_CHARS,
} from "~/task/delegate";

function repo(full: string, opts: { enabled: boolean; autoMerge?: number | null }) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: full,
    $prompt: null,
    $model: null,
    $enabled: opts.enabled ? 1 : 0,
    $deny_test_commands: null,
    $auto_merge: opts.autoMerge ?? null,
    $merge_method: null,
    $refine_enabled: null,
    $refine_prompt: null,
    $implement_enabled: null,
    $implement_label: null,
    $implement_prompt: null,
    $refine_model: null,
    $implement_model: null,
    $auto_ready: null,
  });
}

const noop = () => {};

test("list_repos returns every repo with its flags", () => {
  repo("acme/listed-on", { enabled: true, autoMerge: 1 });
  repo("acme/listed-off", { enabled: false });
  const list = listRepos();
  expect(list.find((r) => r.full_name === "acme/listed-on")).toEqual({
    full_name: "acme/listed-on",
    enabled: true,
    implement_enabled: false,
    auto_merge: true,
  });
  expect(list.find((r) => r.full_name === "acme/listed-off")?.enabled).toBe(false);
});

test("delegate_task on an enabled repo inserts a pending task row and enqueues", () => {
  repo("acme/deleg-ok", { enabled: true });
  let enqueued = 0;
  const res = delegateTask(
    { repo: "acme/deleg-ok", prompt: "Upgrade next to 16.4\nand fix the build" },
    { calls: 0 },
    () => void enqueued++,
  );
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.status).toBe("queued");
  expect(enqueued).toBe(1);
  const row = reviews.byId.get({ $id: res.id })!;
  expect(row.trigger).toBe("task");
  expect(row.status).toBe("pending");
  expect(row.pr_number).toBe(0);
  expect(row.title).toBe("Upgrade next to 16.4");
  expect(row.task_prompt).toBe("Upgrade next to 16.4\nand fix the build");
});

test("an unknown repo is refused and inserts nothing", () => {
  const before = reviews.pendingTasks.all().length;
  const res = delegateTask({ repo: "acme/does-not-exist", prompt: "x" }, { calls: 0 }, noop);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain("not a repository fouine knows");
  expect(reviews.pendingTasks.all().length).toBe(before);
});

test("a disabled repo is refused", () => {
  repo("acme/deleg-disabled", { enabled: false });
  const before = reviews.pendingTasks.all().length;
  let enqueued = 0;
  const res = delegateTask({ repo: "acme/deleg-disabled", prompt: "x" }, { calls: 0 }, () => void enqueued++);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain("not enabled");
  expect(enqueued).toBe(0);
  expect(reviews.pendingTasks.all().length).toBe(before);
});

test("an empty or oversized prompt is refused", () => {
  repo("acme/deleg-prompt", { enabled: true });
  expect(delegateTask({ repo: "acme/deleg-prompt", prompt: "   " }, { calls: 0 }, noop).ok).toBe(false);
  expect(
    delegateTask({ repo: "acme/deleg-prompt", prompt: "a".repeat(MAX_TASK_PROMPT_CHARS + 1) }, { calls: 0 }, noop).ok,
  ).toBe(false);
});

test("calls past the per-request cap are refused", () => {
  repo("acme/deleg-cap", { enabled: true });
  const budget = { calls: 0 };
  const results = Array.from({ length: MAX_TASKS_PER_REQUEST + 3 }, () =>
    delegateTask({ repo: "acme/deleg-cap", prompt: "do it" }, budget, noop),
  );
  expect(results.filter((r) => r.ok).length).toBe(MAX_TASKS_PER_REQUEST);
  const refused = results.slice(MAX_TASKS_PER_REQUEST);
  expect(refused.every((r) => !r.ok)).toBe(true);
  const last = refused.at(-1)!;
  if (!last.ok) expect(last.error).toContain(`at most ${MAX_TASKS_PER_REQUEST}`);
  // A fresh request gets a fresh budget.
  expect(delegateTask({ repo: "acme/deleg-cap", prompt: "again" }, { calls: 0 }, noop).ok).toBe(true);
});

test("the task concurrency setting is clamped and falls back to the default", async () => {
  const { resolveTaskConcurrency, DEFAULT_TASK_CONCURRENCY, MAX_TASK_CONCURRENCY } = await import("~/settings");
  settings.del.run({ $key: SETTINGS.TASK_CONCURRENCY });
  expect(resolveTaskConcurrency()).toBe(DEFAULT_TASK_CONCURRENCY);
  settings.set.run({ $key: SETTINGS.TASK_CONCURRENCY, $value: "5" });
  expect(resolveTaskConcurrency()).toBe(5);
  settings.set.run({ $key: SETTINGS.TASK_CONCURRENCY, $value: "0" });
  expect(resolveTaskConcurrency()).toBe(DEFAULT_TASK_CONCURRENCY);
  settings.set.run({ $key: SETTINGS.TASK_CONCURRENCY, $value: "abc" });
  expect(resolveTaskConcurrency()).toBe(DEFAULT_TASK_CONCURRENCY);
  settings.set.run({ $key: SETTINGS.TASK_CONCURRENCY, $value: "999" });
  expect(resolveTaskConcurrency()).toBe(MAX_TASK_CONCURRENCY);
  settings.del.run({ $key: SETTINGS.TASK_CONCURRENCY });
});
