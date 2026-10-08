import { Effect } from "effect";
import { resolveImplementModel } from "~/settings";
import { log } from "~/server/log";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { guardRun, openPullRequest, prepareWorktree } from "~/effect/agent-run";
import {
  buildTaskPrompt,
  parseNeedsInput,
  taskBranch,
  taskTitle,
} from "~/review/task-prompt";
import { DatabaseError, type ReviewError } from "~/effect/errors";

// The fifth pipeline on the reviews table: a task the dashboard chat delegated
// (trigger = 'task'). Same shape as the issue implementer — worktree, agent,
// commit, push, PR — but driven by a free-form prompt instead of an issue, and
// with three clean endings besides failure:
//   pr_opened   — the agent changed something; a PR is open
//   no_changes  — empty diff: no commit, no PR (the "conditional prompt didn't
//                 apply to this repo" case)
//   needs_input — the agent replied with the NEEDS INPUT marker: nothing is
//                 pushed, its question is stored on the row
// All three are status 'completed' with `outcome` set; only an error is 'failed'.
//
// Unlike the other pipelines the row already exists — the chat tool inserts it
// (status 'pending') so it can answer with an id at once; the queue
// (task/queue.ts) calls this when a slot frees.
export function taskPipeline(
  id: number,
  signal: AbortSignal,
  onStart: (repoFullName: string) => void,
): Effect.Effect<void, ReviewError, DbService | GitHubService | GitService | OpenCodeService> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const row = yield* db.getReview(id);
    // Stopped (or otherwise settled) while it sat in the queue: nothing to do.
    if (!row || row.trigger !== "task" || row.status !== "pending") return;
    const repoFullName = row.repo_full_name;
    const [owner, repoName] = repoFullName.split("/");
    const branch = taskBranch(id);
    // Register the abort controller before any await, same reason as the other
    // pipelines: until onStart runs, the Stop button cannot reach this run.
    yield* Effect.sync(() => onStart(repoFullName));

    const run = (worktree: string) =>
      Effect.gen(function* () {
        log.info("task starting", { repo: repoFullName, review: id });
        yield* db.setRunning(id);

        const repoRow = yield* db.getRepo(repoFullName);
        if (!repoRow) {
          return yield* Effect.fail(
            new DatabaseError({ op: "repos.get", cause: `repo ${repoFullName} no longer exists` }),
          );
        }
        const octokit = yield* gh.installationClient(repoRow.installation_id);
        const token = yield* gh.installationToken(octokit);
        const base = yield* gh.defaultBranch(octokit, owner, repoName);
        const botLogin = yield* gh
          .botLogin()
          .pipe(Effect.catchAll(() => Effect.succeed("fouine[bot]")));

        yield* prepareWorktree({
          repoFullName,
          token,
          ref: `refs/heads/${base}`,
          worktree,
          signal,
        });

        const prompt = buildTaskPrompt({
          repoFullName,
          branch,
          prompt: row.task_prompt ?? "",
        });
        const model = resolveImplementModel(repoRow);

        const result = yield* oc.runReview(
          {
            directory: worktree,
            prompt,
            model,
            agent: "fouine-task",
            transcript: { reviewId: id, repo: repoFullName },
          },
          (sessionId) =>
            Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
          signal,
        );
        log.info("task agent done", {
          repo: repoFullName,
          review: id,
          session: result.sessionId,
          preview: result.text.slice(0, 500),
        });

        const summary = result.text.trim().slice(0, 4000) || "(no summary from the agent)";
        const done = { cost: result.cost, tokens: result.tokens, model };

        // Blocked: no push, whatever is in the worktree is discarded with it.
        const question = parseNeedsInput(result.text);
        if (question !== null) {
          yield* db.completeTask(id, {
            ...done,
            outcome: "needs_input",
            url: null,
            text: question.slice(0, 4000),
          });
          return;
        }

        const changed = yield* git.hasChanges(worktree);
        if (!changed) {
          yield* db.completeTask(id, { ...done, outcome: "no_changes", url: null, text: summary });
          return;
        }

        const title = row.title?.trim() || taskTitle(row.task_prompt ?? "");
        yield* git.commitAll(worktree, title, {
          name: botLogin,
          email: `${botLogin}@users.noreply.github.com`,
        });
        yield* git.pushHead(worktree, branch);

        // The prompt is quoted so a multi-line request can't be mistaken for the
        // rest of the description; the summary is the agent's own words.
        const quoted = (row.task_prompt ?? "")
          .trim()
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
        const body = [
          `## Task`,
          ``,
          quoted,
          ``,
          `## Summary`,
          ``,
          summary,
          ``,
          `---`,
          `_🦡 Done by fouine from a dashboard chat request. Review it like any other PR; a human approval is required before the merger will merge it._`,
        ].join("\n");
        const url = yield* openPullRequest({
          octokit,
          owner,
          repo: repoName,
          title,
          head: branch,
          base,
          body,
        });
        log.info("task opened PR", { repo: repoFullName, review: id, url });
        yield* db.completeTask(id, { ...done, outcome: "pr_opened", url, text: summary });
      });

    yield* guardRun({ label: "task", repoFullName, id, kind: "task", signal }, run);
  });
}
