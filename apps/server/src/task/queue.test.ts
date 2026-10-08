import { test, expect } from "bun:test";
import { repos, reviews } from "~/db";
import { createTaskQueue } from "~/task/queue";
import { isOrphan } from "~/review/reap";

const REPO = "acme/queue-test";
repos.upsert.run({ $full_name: REPO, $installation_id: 1, $prompt: null, $model: null });

const mine = (ids: Set<number>) => () =>
  reviews.pendingTasks.all().filter((r) => ids.has(r.id));

function insertTasks(n: number): Set<number> {
  const ids = new Set<number>();
  for (let i = 0; i < n; i++) {
    ids.add(reviews.insertTask.get({ $repo: REPO, $title: `t${i}`, $prompt: "p" })!.id);
  }
  return ids;
}

// A fake runner: each run moves its row to 'running' like the real pipeline's
// setRunning, then waits until the test releases it.
function fakeRunner() {
  let running = 0;
  let maxRunning = 0;
  const started: number[] = [];
  const release = new Map<number, () => void>();
  const run = (id: number) => {
    started.push(id);
    running++;
    maxRunning = Math.max(maxRunning, running);
    reviews.updateStatus.run({ $status: "running", $done: 0, $id: id });
    return new Promise<void>((resolve) => {
      release.set(id, () => {
        running--;
        reviews.updateStatus.run({ $status: "completed", $done: 1, $id: id });
        resolve();
      });
    });
  };
  return { run, started, release, max: () => maxRunning };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("5 tasks with a cap of 3: at most 3 run at once, the rest start as slots free", async () => {
  const ids = insertTasks(5);
  const fake = fakeRunner();
  const q = createTaskQueue({
    run: fake.run,
    cap: () => 3,
    pending: mine(ids),
    settleStuck: () => {},
  });
  q.pump();
  expect(fake.started.length).toBe(3);
  expect(q.activeCount()).toBe(3);

  fake.release.get(fake.started[0])!();
  await tick();
  expect(fake.started.length).toBe(4);
  fake.release.get(fake.started[1])!();
  await tick();
  expect(fake.started.length).toBe(5);

  for (const id of fake.started) fake.release.get(id)?.();
  await tick();
  expect(fake.max()).toBe(3);
  expect(q.activeCount()).toBe(0);
  // Pumping again starts nothing: every row left the queue.
  q.pump();
  expect(fake.started.length).toBe(5);
});

test("queued tasks resume after a restart (a fresh queue picks up pending rows)", async () => {
  const ids = insertTasks(2);
  // "Restart": the old queue is gone; a new one knows nothing but the DB.
  const fake = fakeRunner();
  const q = createTaskQueue({ run: fake.run, cap: () => 3, pending: mine(ids), settleStuck: () => {} });
  q.pump();
  expect(new Set(fake.started)).toEqual(ids);
  for (const id of fake.started) fake.release.get(id)!();
  await tick();
});

test("the boot reaper fails a running task but leaves a queued one alone", () => {
  expect(isOrphan({ trigger: "task", status: "running" })).toBe(true);
  expect(isOrphan({ trigger: "task", status: "pending" })).toBe(false);
  // Every other pipeline's pending row is still an orphan.
  expect(isOrphan({ trigger: "synchronize", status: "pending" })).toBe(true);
  expect(isOrphan({ trigger: "implement", status: "pending" })).toBe(true);
});

test("a run that ends with its row still pending is settled, not restarted forever", async () => {
  const ids = insertTasks(1);
  const [id] = [...ids];
  let runs = 0;
  const q = createTaskQueue({
    run: async () => void runs++, // returns without ever marking the row running
    cap: () => 3,
    pending: mine(ids),
    settleStuck: (rid) => reviews.fail.run({ $id: rid, $error: "Task could not start" }),
  });
  q.pump();
  await tick();
  await tick();
  expect(runs).toBe(1);
  expect(reviews.byId.get({ $id: id })?.status).toBe("failed");
});

test("a queued task is not picked up by the stale-row reconciler", () => {
  const id = [...insertTasks(1)][0];
  // Old enough to be "wedged" for any other pipeline.
  const future = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
  const stale = reviews.unfinishedBefore.all({ $cutoff: future });
  expect(stale.some((r) => r.id === id)).toBe(false);
});
