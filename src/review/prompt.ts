import type { PullRequestInfo } from "~/review/types";

export const DEFAULT_PROMPT = `You are a senior code reviewer. Review the pull request below.

Be specific and actionable. Focus on correctness, security, performance, and maintainability. Skip nitpicks unless they materially matter. When you suggest a change, point at the exact file and line.

You have the full repository checked out, so explore whatever context you need.

When you are done, post your review using the provided tools:
- post_comment: post the overall review summary as a plain PR comment (markdown).
- post_review: post a formal review with inline comments pinned to specific diff lines (path + line), for findings that belong on the code.

Post the summary via post_comment, then post any line-specific findings via post_review (one call, all inline comments together). Do not duplicate the same point in both.`;

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
