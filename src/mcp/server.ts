import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "octokit";
import { z } from "zod";

const env = process.env;
const required = [
  "FOUINE_GITHUB_TOKEN",
  "FOUINE_REPO_OWNER",
  "FOUINE_REPO_NAME",
  "FOUINE_PR_NUMBER",
];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`[fouine-mcp] missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const octokit = new Octokit({ auth: env.FOUINE_GITHUB_TOKEN });
const owner = env.FOUINE_REPO_OWNER!;
const repo = env.FOUINE_REPO_NAME!;
const pull_number = Number(env.FOUINE_PR_NUMBER);

const server = new McpServer({ name: "fouine", version: "0.1.0" }, { capabilities: { tools: {} } });

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

// Simple PR comment: overview / discussion, no line anchoring.
server.registerTool(
  "post_comment",
  {
    description:
      "Post a plain comment on the pull request (markdown). Use for the overall review summary " +
      "or general discussion. Call as many times as needed.",
    inputSchema: {
      body: z.string().describe("The comment text (markdown)."),
    },
  },
  async (args) => {
    const { data } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: args.body,
    });
    return text(`Comment posted (id ${data.id}).`);
  },
);

// Formal review with optional inline line comments pinned to the diff.
server.registerTool(
  "post_review",
  {
    description:
      "Post a formal PR review: a summary plus optional inline comments pinned to specific " +
      "file lines in the diff. Call once with all inline findings. Use event COMMENT unless " +
      "approving or requesting changes.",
    inputSchema: {
      summary: z.string().describe("Review summary shown at the top of the review."),
      event: z
        .enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"])
        .default("COMMENT")
        .describe("Review state."),
      comments: z
        .array(
          z.object({
            path: z.string().describe("Repository-relative file path."),
            line: z.number().int().describe("Line number in the file to comment on."),
            startLine: z
              .number()
              .int()
              .nullable()
              .default(null)
              .describe("Start line for a multi-line comment; omit for single-line."),
            side: z
              .enum(["LEFT", "RIGHT"])
              .default("RIGHT")
              .describe("Diff side. RIGHT = the PR's new code (usual)."),
            body: z.string().describe("The comment text (markdown)."),
          }),
        )
        .default([]),
    },
  },
  async (args) => {
    const comments = (args.comments ?? []).map((c) => ({
      path: c.path,
      body: c.body,
      side: c.side as "LEFT" | "RIGHT",
      line: c.line,
      ...(c.startLine ? { start_line: c.startLine, line: c.line } : {}),
    }));

    const { data } = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: args.event as "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
      body: args.summary,
      comments,
    });

    return text(`Review posted (id ${data.id}) with ${comments.length} inline comment(s).`);
  },
);

await server.connect(new StdioServerTransport());
