import { tool } from "@opencode-ai/plugin";
import { fouineCtx, ghHeaders } from "./_ctx";

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
      headers: ghHeaders(token, { json: true }),
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
