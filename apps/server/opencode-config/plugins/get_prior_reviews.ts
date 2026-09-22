import type { Plugin } from "@opencode/plugin";
import { call } from "./_ctx";

interface GetPriorReviewsInput {
  pr?: number | null;
}

export default {
  id: "fouine.get_prior_reviews",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "get_prior_reviews",
        description:
          "Fetch a pull request's prior reviews and comments, including the author's replies. " +
          "On a re-review (the author pushed new commits), call this FIRST to recover what you already " +
          "flagged and how the author responded, so you don't re-raise resolved or by-design points. " +
          "Defaults to the PR under review; pass `pr` to read another PR's threads (improver runs).",
        input: {
          type: "object",
          properties: {
            pr: {
              type: "integer",
              description: "PR number to fetch. Omit for the PR currently under review.",
            },
          },
          additionalProperties: false,
        },
        async execute(raw, context) {
          const args = (raw ?? {}) as GetPriorReviewsInput;
          // Omitted `pr` means "the session's own PR" — fouine resolves it (and
          // formats the history) server-side.
          const query = args.pr ? `?pr=${args.pr}` : "";
          const res = await call<{ text: string }>(context.sessionID, `/prior-reviews${query}`);
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
