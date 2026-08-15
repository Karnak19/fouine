import { tool } from "@opencode-ai/plugin";
import { fouineCtx, ghHeaders } from "./_ctx";

// Appended to every review body server-side, so the LLM can't drop it. Reaches an
// agent addressing the review at the moment it's reading it — the reliable place to
// ask for replies, vs. hoping the target repo's AGENTS.md/CLAUDE.md carries the rule.
const AGENT_FOOTER =
  "\n\n---\n_🦡 Addressing this with an agent? After pushing fixes, reply to each " +
  "finding thread you resolved (one line + commit SHA), or say why you didn't, then " +
  "post a summary comment on the PR._";

export default tool({
  description:
    "Post a formal PR review: a summary plus optional inline comments pinned to specific file " +
    "lines in the diff. Call once with all inline findings. Use event COMMENT unless approving " +
    "or requesting changes.",
  args: {
    summary: tool.schema.string().describe("Review summary shown at the top of the review."),
    event: tool.schema
      .enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"])
      .default("COMMENT")
      .describe("Review state."),
    comments: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema.string().describe("Repository-relative file path."),
          line: tool.schema.number().int().describe("Line number in the file to comment on."),
          startLine: tool.schema
            .number()
            .int()
            .nullable()
            .default(null)
            .describe("Start line for a multi-line comment; omit for single-line."),
          side: tool.schema
            .enum(["LEFT", "RIGHT"])
            .default("RIGHT")
            .describe("Diff side. RIGHT = the PR's new code (usual)."),
          severity: tool.schema
            .enum(["blocking", "nit", "question"])
            .describe(
              "The finding's tag: 'blocking' (correctness/security/data-loss/broken contract, " +
                "must fix), 'nit' (taste/style), or 'question' (needs the author, not a change).",
            ),
          body: tool.schema.string().describe("The comment text (markdown)."),
        }),
      )
      .default([]),
  },
  async execute(args) {
    const { token, owner, repo, pr } = fouineCtx();
    const comments = (args.comments ?? []).map((c) => ({
      path: c.path,
      body: c.body,
      side: c.side,
      line: c.line,
      ...(c.startLine ? { start_line: c.startLine, line: c.line } : {}),
    }));
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/reviews`, {
      method: "POST",
      headers: ghHeaders(token, { json: true }),
      body: JSON.stringify({ body: args.summary + AGENT_FOOTER, event: args.event, comments }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id: number };

    // Persist the review to fouine's own store so the dashboard has a structured
    // record. Best-effort — a failed write-back must never fail a posted review.
    await reportFindings([
      { kind: "summary", event: args.event, body: args.summary, githubReviewId: data.id },
      ...(args.comments ?? []).map((c) => ({
        kind: "inline" as const,
        path: c.path,
        line: c.line,
        severity: c.severity,
        body: c.body,
        githubReviewId: data.id,
      })),
    ]);

    return `Review posted (id ${data.id}) with ${comments.length} inline comment(s).`;
  },
});

// Write findings back to the fouine server over the loopback channel wired in
// review.ts. Swallows every error: the GitHub post already succeeded, and losing
// a dashboard record is not worth failing the review the author is waiting on.
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
    // best-effort; the review is already on GitHub
  }
}
