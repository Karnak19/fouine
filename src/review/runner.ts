import { config } from "~/config";
import { getInstallationOctokit } from "~/github";
import { addWorktree, ensureBare, fetchRef, removeWorktree } from "~/git/worktree";
import { reviews, repos } from "~/db";
import { runReview, withOpencode } from "~/review/opencode";
import { buildPrompt } from "~/review/prompt";
import { resolveDefaultModel, resolvePrompt } from "~/settings";
import type { PullRequestInfo, ReviewStatus } from "~/review/types";
import type { Octokit } from "octokit";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { log } from "~/server/log";

function cloneUrl(token: string, fullName: string): string {
  return `https://x-access-token:${token}@github.com/${fullName}.git`;
}

// ponytail: tracks live reviews so the dashboard Stop button can abort the
// underlying opencode server — not just flip the DB row (which would leave a
// still-alive review free to post stale comments after the user stopped it).
// A missing entry means the review already finished or the process died; the
// latter is a true zombie the Stop route has to clean up in the DB alone.
const activeReviews = new Map<number, AbortController>();
export function abortReview(id: number): boolean {
  const ctrl = activeReviews.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

const CHECK_NAME = "fouine";
const MAX_SUMMARY = 65000;

// ponytail: check conclusion is process-based (ran vs crashed), not verdict-based.
// Wiring the agent's REQUEST_CHANGES event => conclusion "failure" needs its event
// to flow back here; add then.
async function startCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<number | undefined> {
  try {
    const { data } = await octokit.rest.checks.create({
      owner,
      repo,
      name: CHECK_NAME,
      head_sha: headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
    });
    return data.id;
  } catch (err) {
    log.warn("check create failed (needs checks:write permission?)", { error: String(err) });
  }
}

async function finishCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number | undefined,
  conclusion: "success" | "failure",
  summary: string,
): Promise<void> {
  if (!checkRunId) return;
  try {
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: conclusion === "success" ? "Review completed" : "Review failed",
        summary: summary.slice(0, MAX_SUMMARY) || "(no output)",
      },
    });
  } catch (err) {
    log.warn("check update failed", { error: String(err) });
  }
}

export async function runReviewForPR(
  pr: PullRequestInfo,
  trigger: string | null = null,
): Promise<void> {
  const repo = repos.get.get({ $full_name: pr.repoFullName });
  const row = reviews.insert.get({
    $repo: pr.repoFullName,
    $pr: pr.number,
    $title: pr.title,
    $session: null,
    $status: "pending",
    $trigger: trigger,
  })!;
  const id = row.id;
  const setStatus = (status: ReviewStatus, done = false) =>
    reviews.updateStatus.run({ $status: status, $done: done ? 1 : 0, $id: id });

  const worktree = resolve(
    config.dataDir,
    "worktrees",
    `${pr.repoFullName.replace("/", "__")}#${pr.number}-${id}`,
  );
  const [owner, repoName] = pr.repoFullName.split("/");

  log.info("review starting", { repo: pr.repoFullName, number: pr.number, review: id });
  setStatus("running");

  const ctrl = new AbortController();
  activeReviews.set(id, ctrl);

  let checkRunId: number | undefined;
  let octokit: Octokit | undefined;
  try {
    octokit = await getInstallationOctokit(pr.installationId);
    checkRunId = await startCheck(octokit, owner, repoName, pr.headSha);
    const auth = (await octokit.auth({ type: "installation" })) as { token: string };

    await ensureBare(pr.repoFullName, cloneUrl(auth.token, pr.repoFullName));
    await fetchRef(pr.repoFullName, `refs/pull/${pr.number}/head`);

    await addWorktree(pr.repoFullName, pr.headSha, worktree);
    log.info("worktree ready", { repo: pr.repoFullName, number: pr.number, path: worktree });

    // Repo-local REVIEW.md, if the repo ships one — additive guidance on top of
    // the chosen reviewer instructions.
    let repoNotes: string | undefined;
    try {
      const notes = (await readFile(resolve(worktree, "REVIEW.md"), "utf8")).trim();
      if (notes) repoNotes = notes;
    } catch {
      // no REVIEW.md
    }

    const prompt = buildPrompt(pr, resolvePrompt(repo?.prompt ?? null), repoNotes);
    // Custom tools (opencode-config/tools) read these to post to GitHub.
    process.env.FOUINE_GITHUB_TOKEN = auth.token;
    process.env.FOUINE_REPO_OWNER = owner;
    process.env.FOUINE_REPO_NAME = repoName;
    process.env.FOUINE_PR_NUMBER = String(pr.number);
    const result = await withOpencode(async (client) => {
      return runReview(
        client,
        {
          directory: worktree,
          prompt,
          model: repo?.model ?? resolveDefaultModel(),
        },
        async (sessionId) => {
          // Persist the id as soon as the session exists, so the dashboard can
          // stream `opencode export` while the review is still in flight.
          reviews.setSession.run({ $session: sessionId, $id: id });
        },
      );
    }, ctrl.signal);
    log.info("review done", {
      repo: pr.repoFullName,
      number: pr.number,
      review: id,
      session: result.sessionId,
      textChars: result.text.length,
      preview: result.text.slice(0, 500),
    });
    reviews.complete.run({ $id: id, $cost: result.cost, $tokens: result.tokens });
    await finishCheck(octokit, owner, repoName, checkRunId, "success", result.text);
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    const message = aborted ? "Stopped by user" : String(err);
    // A user-initiated stop isn't an error — don't pollute error monitoring.
    const lvl = aborted ? log.info : log.error;
    lvl(aborted ? "review stopped" : "review failed", {
      repo: pr.repoFullName,
      number: pr.number,
      review: id,
      ...(aborted ? {} : { error: message }),
    });
    reviews.fail.run({ $id: id, $error: message });
    // finishCheck swallows its own errors; octokit is undefined if the fetch itself threw.
    if (octokit) await finishCheck(octokit, owner, repoName, checkRunId, "failure", message);
    if (aborted) return; // intentional stop — don't surface as an unexpected failure
    throw err;
  } finally {
    activeReviews.delete(id);
    await removeWorktree(pr.repoFullName, worktree);
  }
}
