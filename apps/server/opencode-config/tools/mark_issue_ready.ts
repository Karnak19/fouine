import { tool } from "@opencode-ai/plugin";
import { fouineCtx, ghHeaders } from "./_ctx";

export default tool({
  description:
    "Label this issue with the repo's implement-ready label, queuing it for the implementer. " +
    "Call at most once, and only when the issue is unambiguous enough to implement without " +
    "guessing: acceptance criteria are derivable, scope is bounded, and there is no open " +
    "product question left. Never call it while the comment you just posted lists any blocking " +
    "questions.",
  args: {
    reason: tool.schema
      .string()
      .optional()
      .describe("Optional one-line note on why the issue is ready (echoed back, not posted anywhere)."),
  },
  async execute(args) {
    const { token, owner, repo, pr } = fouineCtx();
    const label = process.env.FOUINE_READY_LABEL;
    // Unset = the repo has auto_ready off. Not an error: the verdict is still
    // useful in the comment, a human just has to add the label themselves.
    if (!label) {
      return "Auto-ready is off for this repository: no label added. A human will add the ready label.";
    }
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pr}/labels`, {
      method: "POST",
      headers: ghHeaders(token, { json: true }),
      body: JSON.stringify({ labels: [label] }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const suffix = args.reason ? ` (${args.reason})` : "";
    return `Issue labelled "${label}"; the implementer will pick it up.${suffix}`;
  },
});
