import type { Plugin } from "@opencode/plugin";
import { call } from "./_ctx";

interface MarkIssueReadyInput {
  reason?: string;
}

export default {
  id: "fouine.mark_issue_ready",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "mark_issue_ready",
        description:
          "Label this issue with the repo's implement-ready label, queuing it for the implementer. " +
          "Call at most once, and only when the issue is unambiguous enough to implement without " +
          "guessing: acceptance criteria are derivable, scope is bounded, and there is no open " +
          "product question left. Never call it while the comment you just posted lists any blocking " +
          "questions.",
        input: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description:
                "Optional one-line note on why the issue is ready (echoed back, not posted anywhere).",
            },
          },
          additionalProperties: false,
        },
        async execute(raw, context) {
          const args = (raw ?? {}) as MarkIssueReadyInput;
          // The ready label and the repo's auto-ready opt-in are resolved
          // server-side now. "Auto-ready is off" is not an error: the route still
          // returns the explanatory text a human-facing tool result needs.
          const res = await call<{ text: string }>(context.sessionID, "/ready-label", {
            method: "POST",
            body: { reason: args.reason },
          });
          return { content: res.text };
        },
      });
    });
  },
} satisfies Plugin;
