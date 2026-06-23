import { config } from "~/config";
import { getInstallationOctokit } from "~/github";
import { addWorktree, ensureBare, fetchRef, removeWorktree } from "~/git/worktree";
import { reviews, repos } from "~/db";
import { runReview } from "~/review/opencode";
import { buildPrompt } from "~/review/prompt";
import type { PullRequestInfo, ReviewStatus } from "~/review/types";
import { resolve } from "node:path";

const log = (msg: string) => console.log(`[review] ${msg}`);

function cloneUrl(token: string, fullName: string): string {
  return `https://x-access-token:${token}@github.com/${fullName}.git`;
}

export async function runReviewForPR(pr: PullRequestInfo): Promise<void> {
  const repo = repos.get.get({ $full_name: pr.repoFullName });
  const row = reviews.insert.get({
    $repo: pr.repoFullName,
    $pr: pr.number,
    $session: null,
    $status: "pending",
  })!;
  const id = row.id;
  const setStatus = (status: ReviewStatus, done = false) =>
    reviews.updateStatus.run({ $status: status, $done: done ? 1 : 0, $id: id });

  const worktree = resolve(
    config.dataDir,
    "worktrees",
    `${pr.repoFullName.replace("/", "__")}#${pr.number}-${id}`,
  );

  log(`${pr.repoFullName}#${pr.number} starting (review #${id})`);
  setStatus("running");

  try {
    const octokit = await getInstallationOctokit(pr.installationId);
    const auth = (await octokit.auth()) as { token: string };

    await ensureBare(pr.repoFullName, cloneUrl(auth.token, pr.repoFullName));
    await fetchRef(pr.repoFullName, `refs/pull/${pr.number}/head`);

    await addWorktree(pr.repoFullName, pr.headSha, worktree);
    log(`worktree ready at ${worktree}`);

    const prompt = buildPrompt(pr, repo?.prompt ?? null);
    const result = await runReview({
      directory: worktree,
      prompt,
      model: repo?.model ?? undefined,
    });
    reviews.setSession.run({ $session: result.sessionId, $id: id });
    log(`${pr.repoFullName}#${pr.number} done (session ${result.sessionId})`);
    setStatus("completed", true);
  } catch (err) {
    log(`${pr.repoFullName}#${pr.number} failed: ${String(err)}`);
    setStatus("failed", true);
    throw err;
  } finally {
    await removeWorktree(pr.repoFullName, worktree);
  }
}
