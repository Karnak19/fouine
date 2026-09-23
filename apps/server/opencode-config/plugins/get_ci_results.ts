import type { Plugin } from "@opencode/plugin";
import { addTool, call } from "./_ctx";

export default {
  id: "fouine.get_ci_results",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      addTool(editor, {
        name: "get_ci_results",
        description:
          "Read this PR's CI results for its head commit: which check runs passed, failed or are still " +
          "running, plus the per-file, per-line annotations the failing ones published (test failures, " +
          "type errors, lint violations). Call this INSTEAD of running the test suite, typechecker or " +
          "linter yourself — CI already ran them on this exact commit, with the env and deps you don't " +
          "have. Call it early, before judging whether the PR is broken. If it reports runs still in " +
          "progress, CI is not finished: never claim the PR passes, and say so in your review.",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute(_raw, context) {
          // The head SHA, check runs and annotations — plus their formatting —
          // all live server-side now (server/internal.ts reuses _ci_format).
          const res = await call<{ text: string }>(context.sessionID, "/ci");
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
