import type { Plugin } from "@opencode/plugin";

// Why this exists — the root cause of reviews wedging until REVIEW_TIMEOUT_MS:
//
// opencode's shell tool takes `timeout` as a MODEL-SUPPLIED argument, and
// nothing in opencode bounds it from above (the value is used directly as the
// kill deadline). Worse, when a command does hit the deadline opencode hands
// the model text like "shell tool terminated command after exceeding timeout
// N ms ... retry with a larger timeout value in milliseconds." The model
// dutifully obeys. So one genuinely wedged command — a recursive grep over a
// huge cache, a network call with no server on the other end — escalates
// instead of failing: 2 min, then 10, then 30, until fouine's own outer
// watchdog kills the entire review. The review is lost to a single bad command
// that should have cost 2 minutes.
//
// There is no config key for this. opencode exposes only
// OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS, which sets the DEFAULT and is
// overridden by whatever the model passes — precisely the case we need to
// stop. `execute.before` is the only lever that clamps the model's own value.
//
// The hook event's `input` is the args object the tool will receive; it is
// mutable (the one deliberately non-readonly field), so we mutate the `timeout`
// property in place. Clamped for both "bash" and "shell": v2 renamed the tool
// but we run against a pinned version only — matching either name costs
// nothing and survives a rename.
//
// ponytail: a flat ceiling, not a per-command allowance. A build or a test suite
// that legitimately needs >2 min gets cut off too, and its output is still
// returned to the model — it just can't buy itself more time. If a real review
// starts needing longer, raise OPENCODE_BASH_TIMEOUT_MAX_MS rather than
// reintroducing model-controlled timeouts.
//
// Env var is deliberately NOT named FOUINE_*: FOUINE_* is fouine's own
// application namespace (GITHUB_APP_PRIVATE_KEY, BETTER_AUTH_SECRET, …), which
// the long-lived opencode server's spawn allowlist never carries. An operator
// knob here belongs in opencode's own OPENCODE_* namespace.
//
// Files in plugins/ must default-export a v2 plugin definition
// ({ id, setup }); anything without a default export is skipped by opencode's
// loader — which is why this file has exactly one default export and no
// exported helpers.
const DEFAULT_MAX_BASH_TIMEOUT_MS = 120_000;

// Validated, not just coerced. A bare Number() here fails in two silent ways,
// both of which are worse than the bug this plugin exists to fix:
//   OPENCODE_BASH_TIMEOUT_MAX_MS=oops -> NaN, and `requested > NaN` is always
//     false, so the model regains an UNBOUNDED timeout while the config still
//     claims a ceiling.
//   OPENCODE_BASH_TIMEOUT_MAX_MS=     -> `??` only catches null/undefined, so an
//     empty string becomes Number("") === 0 — a 0ms cap that kills every command.
// Anything non-finite or non-positive therefore falls back to the default rather
// than being trusted.
function maxBashTimeoutMs(): number {
  const raw = process.env.OPENCODE_BASH_TIMEOUT_MAX_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_BASH_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BASH_TIMEOUT_MS;
  return parsed;
}

const MAX_BASH_TIMEOUT_MS = maxBashTimeoutMs();

export default {
  id: "fouine.cap_bash_timeout",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "bash" && event.tool !== "shell") return;
      const args = (event.input ?? {}) as { timeout?: unknown };
      if (typeof args.timeout === "number" && args.timeout > MAX_BASH_TIMEOUT_MS) {
        args.timeout = MAX_BASH_TIMEOUT_MS;
      }
    });
  },
} satisfies Plugin;
