# Chat tasks

Besides answering questions about your review history, the dashboard chat can hand a code change to an agent. For example: "upgrade `next` to 16.4 on every repo that uses it" becomes one pull request per repo.

The chat has two tools for this:

- **`list_repos`** shows the repos fouine knows, and whether each one is enabled, has the implementer enabled, and has auto-merge on. It only reads fouine's own records. It does not know what a repo contains.
- **`delegate_task`** takes a repo and a prompt. It records a run, returns at once, and the agent works in the background. Each call is one repo; the chat calls it once per target repo.

The chat does not ask for confirmation before starting. The limits below are what keep that safe.

## What a task does

Each task runs on its own branch, `fouine/task-<run id>`, off the repo's default branch. fouine checks the repo out, installs dependencies, runs the task agent with your prompt, then commits, pushes and opens a pull request. The PR description holds your prompt and the agent's 3-line summary.

A task ends in one of these ways:

| Outcome | What happened |
| --- | --- |
| **PR opened** | The agent changed something. The PR is linked from the card and the run page. |
| **No changes** | The agent changed nothing. No commit and no PR. This is normal when the prompt was conditional ("if this repo uses `next`…") and the repo does not match. |
| **Needs input** | The agent was blocked and asked a question. Nothing is pushed; the question is shown on the card and the run page. |
| **Failed** | Something broke. The error is on the run. |

When you do not know which repos are affected, ask the chat to send the same conditional prompt to every enabled repo. The ones where it does not apply end as "no changes".

The chat shows one live card per task, and the run also appears in the dashboard (`/reviews`, `/agents`) with the trigger `task`. The Stop button on the run page stops it, queued or running. The chat forgets earlier tool results between messages, so the cards and the dashboard are where you follow a task, not the next chat message.

## Limits

These are enforced in code, not in the prompt, because the chat reads text that came from GitHub (finding bodies, PR titles) and that text could try to make it start tasks.

- **Enabled repos only.** An unknown or disabled repo is refused with an error the chat can read.
- **At most 20 `delegate_task` calls per chat request.** Calls past that are refused. A refused call counts too.
- **A concurrency cap.** At most N tasks run at once, default 3, set with **Chat tasks** on the dashboard settings page (1 to 20). The rest wait in a queue.
- **A task never merges.** Its PR needs a human approval before the merger will merge it, even on a repo with auto-merge on. fouine's own approval does not count.

## The queue and restarts

Queued tasks are rows in the database, so they survive a restart: at boot they start again as slots free up. A task that was running when the server stopped is marked failed, like any other interrupted run, and is not retried on its own.

## Who can use it

::: warning Without login, anyone who reaches the dashboard can open PRs
`/api/chat` is only protected when GitHub login is configured (`BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, with `ALLOWED_GITHUB_USERS` to restrict who). Without it, anyone who can reach the dashboard can ask the chat to start tasks, and each one opens a pull request on an enabled repo. Turn login on, or keep the dashboard off the public internet.
:::

Tasks use the implementer model (per-repo override, then the global implementer model, then the default model).
