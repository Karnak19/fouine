import type { Plugin } from "@opencode-ai/plugin";

// Why this exists — the root cause of reviews wedging until REVIEW_TIMEOUT_MS:
//
// opencode's bash tool takes `timeout` as a MODEL-SUPPLIED argument, and nothing
// in opencode bounds it from above (the value is used directly as the kill
// deadline). Worse, when a command does hit the deadline opencode hands the model
// this text: "shell tool terminated command after exceeding timeout N ms. If this
// command is expected to take longer ... retry with a larger timeout value in
// milliseconds." The model dutifully obeys. So one genuinely wedged command — a
// recursive grep over a huge cache, a network call with no server on the other
// end — escalates instead of failing: 2 min, then 10, then 30, until fouine's own
// outer watchdog kills the entire review. The review is lost to a single bad
// command that should have cost 2 minutes.
//
// There is no config key for this. opencode exposes only
// OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS, which sets the DEFAULT and is
// overridden by whatever the model passes — precisely the case we need to stop.
// `tool.execute.before` is the only lever that clamps the model's own value.
//
// MUST mutate output.args in place: opencode passes the SAME object it then hands
// to the tool's execute(), so replacing output.args wholesale is silently
// discarded and the clamp would appear to work while doing nothing.
//
// ponytail: a flat ceiling, not a per-command allowance. A build or a test suite
// that legitimately needs >2 min gets cut off too, and its output is still
// returned to the model — it just can't buy itself more time. If a real review
// starts needing longer, raise OPENCODE_BASH_TIMEOUT_MAX_MS rather than
// reintroducing model-controlled timeouts.
//
// Env var is deliberately NOT named FOUINE_*: src/effect/opencode.ts deletes
// every FOUINE_-prefixed key from process.env before each spawn and re-stages
// only the per-review context, so a FOUINE_-prefixed operator setting would be
// silently dropped. Non-FOUINE_ keys are inherited untouched.
// Export ONLY plugin factory functions from this file. opencode loads it with
// `for (const entry of Object.values(mod))` and throws "Plugin export is not a
// function" on anything else (packages/opencode/src/plugin/index.ts:101-105) —
// which would break the plugin load, and with it every review. So keep this
// constant unexported, and don't add an exported helper or type value here.
const MAX_BASH_TIMEOUT_MS = Number(process.env.OPENCODE_BASH_TIMEOUT_MAX_MS ?? 120_000);

export const CapBashTimeout: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (input.tool !== "bash") return;
    const requested: unknown = output.args?.timeout;
    if (typeof requested === "number" && requested > MAX_BASH_TIMEOUT_MS) {
      output.args.timeout = MAX_BASH_TIMEOUT_MS;
    }
  },
});
