import { Effect } from "effect";
import type { Octokit } from "octokit";
import { getApp, getInstallationOctokit } from "~/github";
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

// The App's own bot identity ("<slug>[bot]"), used to pick fouine's own
// reviews out of listReviews — never assume the literal string "fouine", a
// self-hosted install can register the App under any name. Cached: the App's
// identity doesn't change at runtime, and this is a JWT call (app-level, not
// per-installation), worth avoiding on every evaluation.
let cachedBotLogin: string | undefined;

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

    botLogin: (): Effect.Effect<string, GitHubError> => {
      if (cachedBotLogin) return Effect.succeed(cachedBotLogin);
      return Effect.tryPromise({
        try: async () => {
          const { data } = await getApp().octokit.rest.apps.getAuthenticated();
          const login = `${data!.slug}[bot]`;
          cachedBotLogin = login;
          return login;
        },
        catch: (cause) => new GitHubError({ op: "apps.getAuthenticated", cause }),
      });
    },

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

    // fouine's own reviews plus everyone else's, newest-`submitted_at`-last as
    // GitHub returns them. Read from GitHub, never from our DB — the whole
    // point is dodging the phantom-review trap (#97, #104): our DB can say
    // APPROVE while GitHub holds something else entirely.
    listReviews: (
      octokit: Octokit,
      owner: string,
      repo: string,
      pr: number,
    ): Effect.Effect<
      Array<{
        user: string | null;
        state: string;
        submitted_at: string | null;
        html_url: string;
        body: string;
        commit_id: string | null;
      }>,
      GitHubError
    > =>
      Effect.tryPromise({
        try: async () => {
          const { data } = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr,
            per_page: 100,
          });
          return data.map((r) => ({
            user: r.user?.login ?? null,
            state: r.state,
            submitted_at: r.submitted_at ?? null,
            html_url: r.html_url,
            body: r.body ?? "",
            commit_id: r.commit_id ?? null,
          }));
        },
        catch: (cause) => new GitHubError({ op: "pulls.listReviews", cause }),
      }),

    getPull: (
      octokit: Octokit,
      owner: string,
      repo: string,
      pr: number,
    ): Effect.Effect<
      {
        headSha: string;
        baseRef: string;
        draft: boolean;
        mergeable: boolean | null;
        merged: boolean;
        author: string | null;
        title: string;
        body: string;
      },
      GitHubError
    > =>
      Effect.tryPromise({
        try: async () => {
          const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pr });
          return {
            headSha: data.head.sha,
            baseRef: data.base.ref,
            draft: !!data.draft,
            mergeable: data.mergeable ?? null,
            merged: !!data.merged,
            author: data.user?.login ?? null,
            title: data.title ?? "",
            body: data.body ?? "",
          };
        },
        catch: (cause) => new GitHubError({ op: "pulls.get", cause }),
      }),

    // The unified diff for the PR's current head — used only by the merger's
    // risk assessment (merge/assess.ts) right before merging, never persisted.
    // A separate call rather than reusing getPull's response: the diff media
    // type replaces `data` with a raw string, incompatible with the JSON shape
    // getPull already returns.
    getDiff: (
      octokit: Octokit,
      owner: string,
      repo: string,
      pr: number,
    ): Effect.Effect<string, GitHubError> =>
      Effect.tryPromise({
        try: async () => {
          const res = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pr,
            mediaType: { format: "diff" },
          });
          // With the diff media type, octokit hands back the raw diff text as
          // `data` (typed as the JSON shape, but not one at runtime).
          return res.data as unknown as string;
        },
        catch: (cause) => new GitHubError({ op: "pulls.get(diff)", cause }),
      }),

    // Check runs + commit statuses for the head SHA, combined — the merger
    // needs both (a repo can gate on either). Shares the check-runs read with
    // opencode-config/tools/get_ci_results.ts conceptually, but that tool
    // formats for an LLM prompt while this returns raw state for shouldMerge;
    // not worth forcing one module to serve both callers.
    headChecks: (
      octokit: Octokit,
      owner: string,
      repo: string,
      sha: string,
    ): Effect.Effect<
      {
        checks: Array<{ name: string; status: string; conclusion: string | null }>;
        statuses: Array<{ name: string; state: string }>;
      },
      GitHubError
    > =>
      Effect.tryPromise({
        try: async () => {
          const [checkRuns, combined] = await Promise.all([
            octokit.rest.checks.listForRef({ owner, repo, ref: sha, per_page: 100 }),
            octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
          ]);
          return {
            checks: checkRuns.data.check_runs.map((c) => ({
              name: c.name,
              status: c.status,
              conclusion: c.conclusion,
            })),
            statuses: combined.data.statuses.map((s) => ({ name: s.context, state: s.state })),
          };
        },
        catch: (cause) => new GitHubError({ op: "headChecks", cause }),
      }),

    // Branch protection needs `administration:read`, which the App does not
    // request (#117 out of scope). A 403/404 means "can't tell" — that's not a
    // failure of the merger, it's the fallback signal: null means "use all
    // checks on the head SHA" instead of only the required ones.
    branchProtectionRequiredChecks: (
      octokit: Octokit,
      owner: string,
      repo: string,
      branch: string,
    ): Effect.Effect<string[] | null> =>
      Effect.tryPromise(() =>
        octokit.rest.repos.getBranchProtection({ owner, repo, branch }),
      ).pipe(
        Effect.map((res) => res.data.required_status_checks?.contexts ?? null),
        Effect.catchAll(() => Effect.succeed(null)),
      ),

    // Never throws: the caller (merge/evaluate.ts) needs to tell a head-moved
    // 409 and a method-forbidden 405 apart to pick the right disarm message, so
    // both come back as data instead of a typed failure channel.
    mergePull: (
      octokit: Octokit,
      owner: string,
      repo: string,
      pr: number,
      opts: { method: "merge" | "squash" | "rebase"; sha: string },
    ): Effect.Effect<
      { ok: true; sha: string } | { ok: false; status: number; message: string }
    > =>
      Effect.tryPromise(() =>
        octokit.rest.pulls.merge({
          owner,
          repo,
          pull_number: pr,
          merge_method: opts.method,
          sha: opts.sha,
        }),
      ).pipe(
        Effect.map((res) => ({ ok: true as const, sha: res.data.sha })),
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            const status = (cause as { status?: number })?.status ?? 0;
            const message = String((cause as { message?: string })?.message ?? cause);
            log.warn("merge failed", { repo: `${owner}/${repo}`, pr, status, message });
            return { ok: false as const, status, message };
          }),
        ),
      ),
  }),
}) {}
