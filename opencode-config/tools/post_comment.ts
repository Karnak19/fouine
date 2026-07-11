import { tool } from "@opencode-ai/plugin";

export default tool({
  description:
    "Post a plain comment on the pull request (markdown). Use for the overall review summary " +
    "or general discussion. Call as many times as needed.",
  args: {
    body: tool.schema.string().describe("The comment text (markdown)."),
  },
  async execute(args) {
    const { token, owner, repo, pr } = fouineCtx();
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pr}/comments`, {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({ body: args.body }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: number };
    // Best-effort write-back so the dashboard records this comment too (see
    // post_review.ts for why failures here are swallowed).
    await reportFindings([{ kind: "comment", body: args.body, githubCommentId: data.id }]);
    return `Comment posted (id ${data.id}).`;
  },
});

interface FindingPayload {
  kind: "summary" | "inline" | "comment";
  body: string;
  event?: string;
  path?: string;
  line?: number;
  severity?: "blocking" | "nit" | "question";
  githubReviewId?: number;
  githubCommentId?: number;
}
async function reportFindings(findings: FindingPayload[]): Promise<void> {
  const url = process.env.FOUINE_INTERNAL_URL;
  const secret = process.env.FOUINE_INTERNAL_SECRET;
  const reviewId = process.env.FOUINE_REVIEW_ID;
  if (!url || !secret || !reviewId) return;
  try {
    await fetch(`${url}/internal/reviews/${reviewId}/findings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fouine-internal": secret },
      body: JSON.stringify({ findings }),
    });
  } catch {
    // best-effort; the comment is already on GitHub
  }
}

function fouineCtx() {
  const token = process.env.FOUINE_GITHUB_TOKEN;
  const owner = process.env.FOUINE_REPO_OWNER;
  const repo = process.env.FOUINE_REPO_NAME;
  const pr = process.env.FOUINE_PR_NUMBER;
  if (!token || !owner || !repo || !pr) {
    throw new Error("fouine GitHub context env vars are not set");
  }
  return { token, owner, repo, pr };
}

function ghHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}
