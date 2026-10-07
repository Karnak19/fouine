import { reviews } from "~/db";
import { resolveTaskConcurrency } from "~/settings";
import { publishReviewEvent } from "~/server/events";
import { log } from "~/server/log";
import { runTask } from "~/review/runner";

// The queue for chat-delegated tasks. There is no queue data structure: queued
// tasks are 'pending' rows with trigger = 'task' in the reviews table, so the
// queue survives a restart for free and boot just calls pump() (the orphan
// reaper leaves pending tasks alone — see review/reap.ts). The only in-memory
// state is `active`, the ids this process has started and not yet finished,
// which is also what the concurrency cap counts.
// ponytail: single process, in-memory `active` count; a multi-process deploy
// would need the claim to be a DB write (UPDATE ... WHERE status='pending').

export interface TaskQueueDeps {
  run: (id: number) => Promise<void>;
  cap: () => number;
  pending: () => { id: number }[];
  // Called when a run ends and the row is somehow still 'pending' (the pipeline
  // died before marking it running). Without it pump would restart it forever.
  settleStuck: (id: number) => void;
}

export function createTaskQueue(deps: TaskQueueDeps) {
  const active = new Set<number>();

  function pump(): void {
    const cap = deps.cap();
    for (const row of deps.pending()) {
      if (active.size >= cap) break;
      if (active.has(row.id)) continue;
      active.add(row.id);
      log.info("task starting from queue", { review: row.id, running: active.size, cap });
      deps
        .run(row.id)
        .catch((err) => log.error("task run failed", { review: row.id, error: String(err) }))
        .finally(() => {
          active.delete(row.id);
          deps.settleStuck(row.id);
          pump();
        });
    }
  }

  return { pump, activeCount: () => active.size };
}

const queue = createTaskQueue({
  run: runTask,
  cap: resolveTaskConcurrency,
  pending: () => reviews.pendingTasks.all(),
  settleStuck: (id) => {
    const row = reviews.byId.get({ $id: id });
    if (row?.status === "pending") {
      reviews.fail.run({ $id: id, $error: "Task could not start" });
      publishReviewEvent("updated", id);
    }
  },
});

/** Start as many queued tasks as the cap allows. Safe to call any time. */
export const pumpTasks = queue.pump;
