import { config } from "~/config";
import { getInstallationOctokit } from "~/github";
import { addWorktree, ensureBare, fetchRef, removeWorktree } from "~/git/worktree";
import { reviews, repos } from "~/db";
import { runReview, withOpencode } from "~/review/opencode";
import { registerCommentTool } from "~/mcp/register";
import { buildPrompt } from "~/review/prompt";
import { resolveDefaultModel, resolvePrompt } from "~/settings";
import type { PullRequestInfo, ReviewStatus } from "~/review/types";
import { resolve } from "node:path";
import { log } from "~/server/log";

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

  log.info("review starting", { repo: pr.repoFullName, number: pr.number, review: id });
  setStatus("running");

  try {
    const octokit = await getInstallationOctokit(pr.installationId);
    const auth = (await octokit.auth()) as { token: string };

    await ensureBare(pr.repoFullName, cloneUrl(auth.token, pr.repoFullName));
    await fetchRef(pr.repoFullName, `refs/pull/${pr.number}/head`);

    await addWorktree(pr.repoFullName, pr.headSha, worktree);
    log.info("worktree ready", { repo: pr.repoFullName, number: pr.number, path: worktree });

    const prompt = buildPrompt(pr, resolvePrompt(repo?.prompt ?? null));
    const [owner, repoName] = pr.repoFullName.split("/");
    const result = await withOpencode(async (client) => {
      await registerCommentTool(client, {
        token: auth.token,
        owner,
        repo: repoName,
        prNumber: pr.number,
      });
      return runReview(client, {
        directory: worktree,
        prompt,
        model: repo?.model ?? resolveDefaultModel(),
      });
    });
    reviews.setSession.run({ $session: result.sessionId, $id: id });
    log.info("review done", {
      repo: pr.repoFullName,
      number: pr.number,
      review: id,
      session: result.sessionId,
    });
    setStatus("completed", true);
  } catch (err) {
    log.error("review failed", {
      repo: pr.repoFullName,
      number: pr.number,
      review: id,
      error: String(err),
    });
    setStatus("failed", true);
    throw err;
  } finally {
    await removeWorktree(pr.repoFullName, worktree);
  }
}
