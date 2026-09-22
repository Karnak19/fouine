import type { Plugin } from "@opencode/plugin";
import { call } from "./_ctx";

// The improver's only write path. The agent hands over content; fouine does the
// GitHub writes programmatically (branch + commit + PR), so the agent never
// holds free-form write access — and the human merging the PR is the gate on
// what actually reaches future reviews.

interface ProposeReviewNotesInput {
  content?: string;
  summary?: string;
}

export default {
  id: "fouine.propose_review_notes",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "propose_review_notes",
        description:
          "Propose an updated REVIEW.md via a pull request. Call at most once, with the COMPLETE new " +
          "file content (it replaces the whole file). Creates or force-updates the fouine/review-notes " +
          "branch and opens (or refreshes) the PR. Do NOT call if there is nothing worth changing.",
        input: {
          type: "object",
          properties: {
            content: { type: "string", description: "Full new REVIEW.md content (markdown)." },
            summary: {
              type: "string",
              description: "PR body: what was learned, from which PRs/threads, and what changed.",
            },
          },
          required: ["content", "summary"],
          additionalProperties: false,
        },
        async execute(raw, context) {
          const args = (raw ?? {}) as ProposeReviewNotesInput;
          // The branch juggling, the REVIEW.md commit and the PR create/update
          // all happen server-side now; the plugin just hands over the content.
          const res = await call<{ text: string }>(context.sessionID, "/proposal", {
            method: "POST",
            body: { content: args.content ?? "", summary: args.summary ?? "" },
          });
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
