import type { PullRequestInfo } from "~/review/types";

export const DEFAULT_PROMPT = `You are a senior code reviewer. Review the pull request below.

Be specific and actionable. Focus on correctness, security, performance, and maintainability. Skip nitpicks unless they materially matter. When you suggest a change, point at the exact file and line.

You have the full repository checked out, so explore whatever context you need. When you are done, post your review using the provided comment tool (a summary plus inline comments on specific lines). Do not write a long prose summary if inline comments already cover it.`;

export function buildPrompt(pr: PullRequestInfo, userPrompt: string | null): string {
  const focus = userPrompt?.trim() || DEFAULT_PROMPT;
  return [
    `# Code review request`,
    ``,
    `- Repository: ${pr.repoFullName}`,
    `- PR #${pr.number}: ${pr.title}`,
    `- Branch: ${pr.headRef} -> ${pr.baseRef}`,
    `- Head SHA: ${pr.headSha}`,
    `- Base SHA: ${pr.baseSha}`,
    ``,
    `The repository is checked out at the PR head in the current directory. To see the diff, run:`,
    `\`git diff ${pr.baseSha}...${pr.headSha}\``,
    ``,
    `## Reviewer instructions`,
    ``,
    focus,
  ].join("\n");
}
