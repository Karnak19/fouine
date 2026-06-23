import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "octokit";
import { z } from "zod";

const env = process.env;
const required = ["FOUINE_GITHUB_TOKEN", "FOUINE_REPO_OWNER", "FOUINE_REPO_NAME", "FOUINE_PR_NUMBER"];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`[fouine-mcp] missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const octokit = new Octokit({ auth: env.FOUINE_GITHUB_TOKEN });
const owner = env.FOUINE_REPO_OWNER!;
const repo = env.FOUINE_REPO_NAME!;
const pull_number = Number(env.FOUINE_PR_NUMBER);

const server = new McpServer(
  { name: "fouine", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.registerTool(
  "post_pr_review",
  {
    description:
      "Post the code review as a PR review with a summary and inline line comments. " +
      "Call this exactly once when the review is complete. Use COMMENT event unless " +
      "requesting changes or approving.",
    inputSchema: {
      summary: z.string().describe("The review summary shown at the top of the review."),
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

    const review = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: args.event as "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
      body: args.summary,
      comments,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Review posted (id ${review.data.id}) with ${comments.length} inline comment(s).`,
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
