import { tool } from "@opencode-ai/plugin";
import { fouineRepoCtx, ghHeaders } from "./_ctx";

// The improver's only write path. The agent hands over content; this tool does
// the GitHub writes programmatically (branch + commit + PR), so the agent never
// holds free-form write access — and the human merging the PR is the gate on
// what actually reaches future reviews.
const BRANCH = "fouine/review-notes";

const PR_FOOTER =
  "\n\n---\n_🦡 Proposed by fouine's outer-loop improver from human feedback on recent " +
  "review threads. Merging updates the guidance injected into every future review; " +
  "close to reject._";

export default tool({
  description:
    "Propose an updated REVIEW.md via a pull request. Call at most once, with the COMPLETE new " +
    "file content (it replaces the whole file). Creates or force-updates the fouine/review-notes " +
    "branch and opens (or refreshes) the PR. Do NOT call if there is nothing worth changing.",
  args: {
    content: tool.schema.string().describe("Full new REVIEW.md content (markdown)."),
    summary: tool.schema
      .string()
      .describe("PR body: what was learned, from which PRs/threads, and what changed."),
  },
  async execute(args) {
    const { token, owner, repo } = fouineRepoCtx();
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const get = ghHeaders(token);
    const json = ghHeaders(token, { json: true });

    const repoInfo = (await gh(`${base}`, { headers: get })) as { default_branch: string };
    const defaultBranch = repoInfo.default_branch;
    const head = (await gh(`${base}/git/ref/heads/${defaultBranch}`, { headers: get })) as {
      object: { sha: string };
    };

    // Reset the branch onto the default head (create if missing) so re-runs
    // produce exactly one commit on top and one open PR, never a pile-up.
    const create = await fetch(`${base}/git/refs`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: head.object.sha }),
    });
    if (!create.ok) {
      if (create.status !== 422) throw new Error(`GitHub ${create.status}: ${await create.text()}`);
      await gh(`${base}/git/refs/heads/${BRANCH}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ sha: head.object.sha, force: true }),
      });
    }

    // Existing file sha on the branch, if any (contents PUT requires it to update).
    const existing = await fetch(`${base}/contents/REVIEW.md?ref=${BRANCH}`, { headers: get });
    const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;

    await gh(`${base}/contents/REVIEW.md`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({
        message: "chore: update review notes from review-thread feedback",
        content: Buffer.from(args.content, "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    const open = (await gh(
      `${base}/pulls?head=${owner}:${encodeURIComponent(BRANCH)}&state=open`,
      { headers: get },
    )) as Array<{ number: number; html_url: string }>;
    const body = args.summary + PR_FOOTER;
    if (open.length) {
      await gh(`${base}/pulls/${open[0].number}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ body }),
      });
      return `Updated existing proposal PR: ${open[0].html_url}`;
    }
    const pr = (await gh(`${base}/pulls`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        title: "fouine: update REVIEW.md from review feedback",
        head: BRANCH,
        base: defaultBranch,
        body,
      }),
    })) as { html_url: string };
    return `Opened proposal PR: ${pr.html_url}`;
  },
});

async function gh(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}
