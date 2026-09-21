import type { Plugin } from "@opencode/plugin";
import { call } from "./_ctx";

interface PostCommentInput {
  body?: string;
}

export default {
  id: "fouine.post_comment",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "post_comment",
        description:
          "Post a plain comment on the pull request (markdown). Use for the overall review summary " +
          "or general discussion. Call as many times as needed.",
        input: {
          type: "object",
          properties: {
            body: { type: "string", description: "The comment text (markdown)." },
          },
          required: ["body"],
          additionalProperties: false,
        },
        async execute(raw, context) {
          const args = (raw ?? {}) as PostCommentInput;
          const res = await call<{ text: string }>(context.sessionID, "/comment", {
            method: "POST",
            body: { body: args.body ?? "" },
          });
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
