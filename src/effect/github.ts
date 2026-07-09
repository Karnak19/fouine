import { Effect } from "effect";
import type { Octokit } from "octokit";
import { getInstallationOctokit } from "~/github";
import { log } from "~/server/log";
import { GitHubError } from "~/effect/errors";

const CHECK_NAME = "fouine";
const MAX_SUMMARY = 65000;

export class GitHubService extends Effect.Service<GitHubService>()("app/GitHubService", {
  sync: () => ({
    installationClient: (installationId: number): Effect.Effect<Octokit, GitHubError> =>
      Effect.tryPromise({
        try: () => getInstallationOctokit(installationId),
        catch: (cause) => new GitHubError({ op: "getInstallationOctokit", cause }),
      }),

    installationToken: (octokit: Octokit): Effect.Effect<string, GitHubError> =>
      Effect.tryPromise({
        try: async () => ((await octokit.auth({ type: "installation" })) as { token: string }).token,
        catch: (cause) => new GitHubError({ op: "auth", cause }),
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
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            log.warn("check create failed (needs checks:write permission?)", {
              error: String(cause),
            });
            return undefined;
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
    ): Effect.Effect<void> => {
      if (!checkRunId) return Effect.void;
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
        Effect.asVoid,
        Effect.catchAll((cause) =>
          Effect.sync(() => log.warn("check update failed", { error: String(cause) })),
        ),
      );
    },
  }),
}) {}
