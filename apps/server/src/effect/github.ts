import { Effect } from "effect";
import type { Octokit } from "octokit";
import { getInstallationOctokit } from "~/github";
import { log } from "~/server/log";
import { GitHubError } from "~/effect/errors";

export const CHECK_NAME = "fouine";
const MAX_SUMMARY = 65000;

// No GitHub check call may hang the pipeline: fetch has no default timeout, and
// finishCheck runs after the opencode watchdog is already dismissed (the race
// ends when runReview wins), so a stalled checks.update used to wedge the fiber
// — row settled, check open — forever. 30s turns that into an ordinary failure
// the finaliser and the reconciler know how to handle.
const CHECK_TIMEOUT_MS = 30_000;

// Best-effort read of an error's HTTP status through Effect's UnknownException
// wrapper (or a bare throw): a missing check run is "already gone", not a
// reason to keep retrying.
const isNotFound = (cause: unknown): boolean => {
  const err = cause as { error?: { status?: unknown }; status?: unknown } | null;
  return err?.error?.status === 404 || err?.status === 404;
};

export class GitHubService extends Effect.Service<GitHubService>()("app/GitHubService", {
  sync: () => ({
    installationClient: (installationId: number): Effect.Effect<Octokit, GitHubError> =>
      Effect.tryPromise({
        try: () => getInstallationOctokit(installationId),
        catch: (cause) => new GitHubError({ op: "getInstallationOctokit", cause }),
      }).pipe(
        Effect.timeoutFail({
          duration: CHECK_TIMEOUT_MS,
          onTimeout: () => new GitHubError({ op: "getInstallationOctokit", cause: "timeout" }),
        }),
      ),

    installationToken: (octokit: Octokit): Effect.Effect<string, GitHubError> =>
      Effect.tryPromise({
        try: async () => ((await octokit.auth({ type: "installation" })) as { token: string }).token,
        catch: (cause) => new GitHubError({ op: "auth", cause }),
      }),

    defaultBranch: (octokit: Octokit, owner: string, repo: string): Effect.Effect<string, GitHubError> =>
      Effect.tryPromise({
        try: async () => (await octokit.rest.repos.get({ owner, repo })).data.default_branch,
        catch: (cause) => new GitHubError({ op: "repos.get", cause }),
      }),

    // Check create/update are best-effort: a repo without checks:write must not
    // fail the review. Both swallow their own errors (log + carry on), exactly
    // as the imperative startCheck/finishCheck did.
    startCheck: (
      octokit: Octokit,
      owner: string,
      repo: string,
      headSha: string,
    ): Effect.Effect<number | undefined> =>
      Effect.tryPromise(() =>
        octokit.rest.checks.create({
          owner,
          repo,
          name: CHECK_NAME,
          head_sha: headSha,
          status: "in_progress",
          started_at: new Date().toISOString(),
          output: {
            title: "Review in progress…",
            summary: "Fouine is reviewing this pull request. Findings will appear here when done.",
          },
        }),
      ).pipe(
        Effect.map((res) => res.data.id as number | undefined),
        // Past the timeout the run id is lost to us even if GitHub did create
        // the run — same as any other create failure: the review proceeds and
        // the row simply carries no check to close.
        Effect.timeout(CHECK_TIMEOUT_MS),
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            log.warn("check create failed (needs checks:write permission?)", {
              error: String(cause),
            });
            return undefined;
          }),
        ),
      ),

    // Best-effort like the check calls: a missing permission or an API hiccup
    // must never fail the caller — log and carry on.
    createIssueComment: (
      octokit: Octokit,
      owner: string,
      repo: string,
      issueNumber: number,
      body: string,
    ): Effect.Effect<void> =>
      Effect.tryPromise(() =>
        octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body }),
      ).pipe(
        Effect.asVoid,
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            log.warn("issue comment create failed", { error: String(cause) });
          }),
        ),
      ),

    finishCheck: (
      octokit: Octokit,
      owner: string,
      repo: string,
      checkRunId: number | undefined,
      conclusion: "success" | "failure",
      summary: string,
      // Returns whether the check run was actually closed: `false` when there is
      // nothing to close (no check run id) or when the update failed and we
      // swallowed it. Callers use that to know the run may still be in_progress.
    ): Effect.Effect<boolean> => {
      if (!checkRunId) return Effect.succeed(false);
      return Effect.tryPromise(() =>
        octokit.rest.checks.update({
          owner,
          repo,
          check_run_id: checkRunId,
          status: "completed",
          conclusion,
          completed_at: new Date().toISOString(),
          output: {
            title: conclusion === "success" ? "Review completed" : "Review failed",
            summary: summary.slice(0, MAX_SUMMARY) || "(no output)",
          },
        }),
      ).pipe(
        Effect.as(true),
        Effect.timeout(CHECK_TIMEOUT_MS),
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            log.warn("check update failed", { error: String(cause) });
            return false;
          }),
        ),
      );
    },

    // GitHub-side truth for one check run: "open" still needs closing, "closed"
    // doesn't, "unknown" means ask again next tick. Never fails — a missing run
    // (404) counts as closed, anything else as unknown.
    checkStatus: (
      octokit: Octokit,
      owner: string,
      repo: string,
      checkRunId: number,
    ): Effect.Effect<"open" | "closed" | "unknown"> =>
      Effect.tryPromise(() =>
        octokit.rest.checks.get({ owner, repo, check_run_id: checkRunId }),
      ).pipe(
        Effect.map((res): "open" | "closed" => (res.data.status === "completed" ? "closed" : "open")),
        Effect.timeout(CHECK_TIMEOUT_MS),
        Effect.catchAll(
          (cause): Effect.Effect<"open" | "closed" | "unknown"> =>
            Effect.succeed(isNotFound(cause) ? "closed" : "unknown"),
        ),
      ),
  }),
}) {}
