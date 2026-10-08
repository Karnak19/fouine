import { repos, reviews } from "~/db";
import { publishReviewEvent } from "~/server/events";
import { log } from "~/server/log";
import { taskTitle } from "~/review/task-prompt";
import { pumpTasks } from "~/task/queue";
import { resolveAutoMerge, resolveImplementEnabled } from "~/settings";

// The logic behind the chat's `list_repos` and `delegate_task` tools, kept out
// of chat/index.ts so the guards can be tested without a model in the loop.
//
// The chat reads text that came from GitHub (finding bodies, PR titles), so
// nothing the model says is trusted: every limit here is enforced in code and
// answers with an error the model can read, never with a quiet no-op.

// At most this many delegate_task calls per /api/chat request, refused calls
// included. 20 repos in one sentence is the intended ceiling.
export const MAX_TASKS_PER_REQUEST = 20;
export const MAX_TASK_PROMPT_CHARS = 8_000;

export interface RepoListing {
  full_name: string;
  enabled: boolean;
  implement_enabled: boolean;
  auto_merge: boolean;
}

export function listRepos(): RepoListing[] {
  return repos.list.all().map((r) => ({
    full_name: r.full_name,
    enabled: r.enabled === 1,
    // Resolved values (repo override, else the global setting), what actually applies.
    implement_enabled: resolveImplementEnabled(r.implement_enabled),
    auto_merge: resolveAutoMerge(r.auto_merge),
  }));
}

export type DelegateResult =
  | { ok: true; id: number; repo: string; status: "queued" }
  | { ok: false; error: string };

/** One counter per chat request; create it inside the request, never at module level. */
export interface DelegateBudget {
  calls: number;
}

export function delegateTask(
  input: { repo: string; prompt: string },
  budget: DelegateBudget,
  // Injectable so tests never start a real run.
  enqueue: () => void = pumpTasks,
): DelegateResult {
  budget.calls++;
  if (budget.calls > MAX_TASKS_PER_REQUEST) {
    return {
      ok: false,
      error: `Refused: at most ${MAX_TASKS_PER_REQUEST} tasks can be started per chat request. Tell the user which repos were not started.`,
    };
  }
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Refused: the prompt is empty." };
  if (prompt.length > MAX_TASK_PROMPT_CHARS) {
    return {
      ok: false,
      error: `Refused: the prompt is over ${MAX_TASK_PROMPT_CHARS} characters. Shorten it.`,
    };
  }
  const repo = repos.get.get({ $full_name: input.repo });
  if (!repo) {
    return {
      ok: false,
      error: `Refused: "${input.repo}" is not a repository fouine knows. Call list_repos for the exact names.`,
    };
  }
  if (repo.enabled !== 1) {
    return {
      ok: false,
      error: `Refused: ${repo.full_name} is not enabled in fouine, so no task can run there.`,
    };
  }

  const row = reviews.insertTask.get({
    $repo: repo.full_name,
    $title: taskTitle(prompt),
    $prompt: prompt,
  })!;
  publishReviewEvent("created", row.id);
  log.info("task queued", { review: row.id, repo: repo.full_name });
  // Do not await the run: it takes minutes. pump() only starts it (cap allowing).
  enqueue();
  return { ok: true, id: row.id, repo: repo.full_name, status: "queued" };
}
