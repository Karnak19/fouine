import type { Plugin } from "@opencode/plugin";
import { call } from "./_ctx";

interface PostReviewInput {
  summary?: string;
  event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  comments?: Array<{
    path?: string;
    line?: number;
    startLine?: number | null;
    side?: "LEFT" | "RIGHT";
    severity?: "blocking" | "nit" | "question";
    body?: string;
  }>;
}

export default {
  id: "fouine.post_review",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "post_review",
        description:
          "Post a formal PR review: a summary plus optional inline comments pinned to specific file " +
          "lines in the diff. Call once with all inline findings. To offer a one-click fix, end a " +
          "comment body with a ```suggestion fence containing the full verbatim replacement for " +
          "exactly the commented lines.",
        input: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Review summary shown at the top of the review.",
            },
            event: {
              type: "string",
              enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"],
              description: "Review state. Defaults to COMMENT.",
            },
            comments: {
              type: "array",
              description: "Inline findings. Defaults to none.",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", description: "Repository-relative file path." },
                  line: { type: "integer", description: "Line number in the file to comment on." },
                  startLine: {
                    type: "integer",
                    description:
                      "Start line for a multi-line comment; omit for single-line.",
                  },
                  side: {
                    type: "string",
                    enum: ["LEFT", "RIGHT"],
                    description: "Diff side. RIGHT = the PR's new code (usual). Defaults to RIGHT.",
                  },
                  severity: {
                    type: "string",
                    enum: ["blocking", "nit", "question"],
                    description:
                      "The finding's tag: 'blocking' (correctness/security/data-loss/broken contract, " +
                        "must fix), 'nit' (taste/style), or 'question' (needs the author, not a change).",
                  },
                  body: {
                    type: "string",
                    description:
                      "The comment text (markdown). For a certain fix, end with a ```suggestion fence " +
                        "holding the full replacement for exactly the commented lines (pin startLine..line " +
                        "to those lines); one block per comment, never for questions.",
                  },
                },
                required: ["path", "line", "severity", "body"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary"],
          additionalProperties: false,
        },
        async execute(raw, context) {
          const args = (raw ?? {}) as PostReviewInput;
          // Build the same body as before, minus the GitHub-shaped comment
          // mapping: fouine does that server-side now, along with the AGENT_FOOTER
          // and persisting the findings to its own store.
          const res = await call<{ text: string }>(context.sessionID, "/review", {
            method: "POST",
            body: {
              summary: args.summary ?? "",
              event: args.event ?? "COMMENT",
              comments: args.comments ?? [],
            },
          });
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
