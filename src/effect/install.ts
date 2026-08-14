import { Effect } from "effect";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "~/config";
import { log } from "~/server/log";

// The parameter stays overridable so the test can inject a 50ms timeout.

// Why fouine installs instead of letting the reviewer do it:
//
// The worktree is a bare `git worktree add` checkout — no node_modules. The
// agent wants to verify library APIs, so with nothing local it goes hunting the
// filesystem and ends up recursively grepping the container's global bun cache,
// which wedges the review. And left to itself it will eventually just run
// `bun install`, which is worse: see the --ignore-scripts note below.
//
// Never fails. A repo with no lockfile, a private registry or no network at all
// must degrade to exactly today's behaviour, so every failure path here is a log
// line and a return.
export function installDeps(
  worktree: string,
  signal: AbortSignal,
  timeoutMs = config.review.installTimeoutMs,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    // ponytail: node/bun only. Multi-ecosystem (pip, go mod, maven) is a
    // deliberate non-goal — the ceiling is "one package manager, one command".
    // Upgrade path when it matters: detect the manifest (requirements.txt,
    // go.mod, pom.xml) and map it to one install command in a small table here;
    // don't grow per-manager branching inside this function.
    if (!existsSync(resolve(worktree, "package.json"))) return Effect.void;

    return Effect.tryPromise({
      // The AbortSignal Effect hands us here fires on fiber interruption, so
      // `any` gives one signal covering all three ways this must die: the
      // review's own abort (/review stop, superseded commit), an Effect
      // interrupt, and the hard timeout. Bun.spawn's `signal` option SIGTERMs
      // the child on abort — verified it actually reaps the process, not just
      // abandons the promise.
      try: async (interrupt) => {
        const started = Date.now();
        const proc = Bun.spawn(
          // --ignore-scripts is a SECURITY control, NOT a perf tweak. DO NOT
          // REMOVE. Without it `bun install` runs postinstall scripts authored
          // by the PR under review — arbitrary code, as root, in a process
          // whose env holds FOUINE_GITHUB_TOKEN (a GitHub App installation
          // token) and FOUINE_INTERNAL_SECRET. A PR that adds a postinstall
          // would exfiltrate both before a human ever read the diff.
          //
          // No --frozen-lockfile on purpose: PRs legitimately change
          // package.json, and frozen fails when the lockfile lags. The worktree
          // is disposable, so letting the lockfile mutate costs nothing.
          ["bun", "install", "--ignore-scripts"],
          {
            cwd: worktree,
            signal: AbortSignal.any([signal, interrupt, AbortSignal.timeout(timeoutMs)]),
            stdout: "ignore",
            stderr: "pipe",
          },
        );
        const code = await proc.exited;
        const ms = Date.now() - started;
        if (code === 0) {
          log.info("dependencies installed", { path: worktree, ms });
          return;
        }
        // A stop isn't a failure — the review is going away anyway, so log it as
        // info and don't put "install failed" in the operator's warn stream.
        // Keep timeout distinct from abort too: "which one killed it" is the
        // whole point of the logging, and one lumped message throws it away.
        if (proc.signalCode && signal.aborted) {
          log.info("dependency install interrupted by stop", { path: worktree, ms });
          return;
        }
        const why = proc.signalCode
          ? `killed with ${proc.signalCode} after ${ms}ms (timeout ${timeoutMs}ms)`
          : (await new Response(proc.stderr).text()).trim().slice(-500) || `exit ${code}`;
        log.warn("dependency install failed — continuing without node_modules", {
          path: worktree,
          reason: why,
        });
      },
      catch: (cause) => cause,
    }).pipe(
      Effect.catchAll((cause) =>
        Effect.sync(() =>
          log.warn("dependency install could not be started — continuing", {
            path: worktree,
            error: String(cause),
          }),
        ),
      ),
    );
  });
}
