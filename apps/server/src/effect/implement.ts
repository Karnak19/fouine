import { Effect, Exit } from "effect";
import { resolve } from "node:path";
import { cloneUrl, failureMessage, writeFailure } from "~/effect/review";
import { resolveDefaultModel, resolveImplementPrompt } from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { internalSecret, internalBaseUrl } from "~/server/internal";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { installDeps } from "~/effect/install";
import { OpenCodeService } from "~/effect/opencode";
import { refineToolEnv } from "~/review/opencode";
import { buildImplementPrompt } from "~/review/implement-prompt";
import { fetchIssueInfo } from "~/github";
import { GitHubError, type ReviewError } from "~/effect/errors";

export interface ImplementTarget {
  repoFullName: string;
  installationId: number;
  issueNumber: number;
  // Row title, from the webhook payload (or a placeholder from the API route):
  // the row is inserted before the issue is fetched, so it cannot use the real
  // title yet — see the ordering note below.
  issueTitle: string;
}

export const implementBranch = (n: number): string => `fouine/issue-${n}`;

// The fourth pipeline on the reviews table: implement an already-refined issue,
// push a branch, and open (or update) a PR — the only pipeline that pushes
// code. Tracked as a reviews row with trigger = 'implement' and pr_number =
// the issue number, same sharing trick as the refiner.
// ponytail: implementer rides the reviews table; dedicated table if the
// dashboard ever needs to render these runs differently.
export function implementPipeline(
  target: ImplementTarget,
  signal: AbortSignal,
  onStart: (id: number) => void,
): Effect.Effect<void, ReviewError, DbService | GitHubService | GitService | OpenCodeService> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const [owner, repoName] = target.repoFullName.split("/");
    const branch = implementBranch(target.issueNumber);

    // Insert the row and call onStart FIRST, before any network round-trip —
    // same reasoning as the improver. Until onStart runs, the runner hasn't
    // registered this signal's AbortController in activeReviews, so
    // supersedeInFlight and /fouine stop are dead. Fetching the issue over the
    // network first would leave that window open for two round-trips instead
    // of zero, letting two triggers both run to completion.
    const id = yield* db.insertReview({
      repo: target.repoFullName,
      pr: target.issueNumber,
      title: target.issueTitle,
      trigger: "implement",
    });
    yield* Effect.sync(() => onStart(id));

    const run = (worktree: string) =>
      Effect.gen(function* () {
        log.info("implementer starting", {
          repo: target.repoFullName,
          review: id,
          issue: target.issueNumber,
        });
        yield* db.setRunning(id);

        const octokit = yield* gh.installationClient(target.installationId);
        const issue = yield* Effect.tryPromise({
          try: () =>
            fetchIssueInfo(octokit, target.repoFullName, target.issueNumber),
          catch: (cause) => new GitHubError({ op: "issues.get", cause }),
        });

        const token = yield* gh.installationToken(octokit);
        const base = yield* gh.defaultBranch(octokit, owner, repoName);
        const botLogin = yield* gh.botLogin().pipe(Effect.catchAll(() => Effect.succeed("fouine[bot]")));

        // Resume on the issue's own branch if a previous attempt already
        // pushed one — otherwise start fresh off the default branch. Fails
        // closed on any error other than "branch doesn't exist yet" (like the
        // improver's pulls.list): a transient GitHub error must not silently
        // fall back to the default branch and lose a previous attempt's work.
        const branchExists = yield* Effect.tryPromise({
          try: () => octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${branch}` }),
          catch: (cause) => cause,
        }).pipe(
          Effect.map(() => true),
          Effect.catchAll((cause) => {
            if ((cause as { status?: number }).status === 404) return Effect.succeed(false);
            return Effect.fail(new GitHubError({ op: "git.getRef", cause }));
          }),
        );
        const checkoutRef = branchExists ? `refs/heads/${branch}` : `refs/heads/${base}`;

        yield* git.ensureBare(target.repoFullName, cloneUrl(token, target.repoFullName));
        const sha = yield* git.fetchRef(target.repoFullName, checkoutRef);
        yield* git.addWorktree(target.repoFullName, sha, worktree);
        yield* installDeps(worktree, signal);
        // bun install may rewrite the lockfile (no --frozen-lockfile, see
        // install.ts); that churn must not end up in the PR, so reset tracked
        // files before the agent starts.
        yield* git.discardChanges(worktree);

        const repoRow = yield* db.getRepo(target.repoFullName);
        const prompt = buildImplementPrompt(
          issue,
          branch,
          resolveImplementPrompt(repoRow?.implement_prompt ?? null),
        );
        const model = repoRow?.model || resolveDefaultModel();

        const result = yield* oc.runReview(
          {
            directory: worktree,
            prompt,
            model,
            agent: "fouine-implementer",
            transcript: { reviewId: id, repo: target.repoFullName },
            // No denyTestCommands: unlike a review, the implementer must be
            // able to run the repo's own tests to verify its own change.
            env: refineToolEnv({
              githubToken: token,
              owner,
              repo: repoName,
              issueNumber: target.issueNumber,
              reviewId: id,
              internalUrl: internalBaseUrl,
              internalSecret,
            }),
          },
          (sessionId) =>
            Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
          signal,
        );

        log.info("implementer done", {
          repo: target.repoFullName,
          review: id,
          session: result.sessionId,
          preview: result.text.slice(0, 500),
        });

        const summary = result.text.trim().slice(0, 4000) || "(no summary from the agent)";

        const changed = yield* git.hasChanges(worktree);
        if (!changed) {
          yield* gh.createIssueComment(
            octokit,
            owner,
            repoName,
            target.issueNumber,
            `🦡 I didn't change anything for this issue.\n\n${summary}`,
          );
          yield* db.complete(id, result.cost, result.tokens, model, null);
          return;
        }

        yield* git.commitAll(worktree, `feat: ${issue.title} (#${target.issueNumber})`, {
          name: botLogin,
          email: `${botLogin}@users.noreply.github.com`,
        });
        yield* git.pushHead(worktree, branch);

        const existing = yield* Effect.tryPromise({
          try: () =>
            octokit.rest.pulls.list({
              owner,
              repo: repoName,
              state: "open",
              head: `${owner}:${branch}`,
            }),
          catch: (cause) => new GitHubError({ op: "pulls.list", cause }),
        }).pipe(Effect.map((res) => res.data[0]));

        let url: string;
        if (existing) {
          yield* gh.createIssueComment(
            octokit,
            owner,
            repoName,
            existing.number,
            `🦡 Pushed another commit for #${target.issueNumber}:\n\n${summary}`,
          );
          url = existing.html_url;
        } else {
          const body = [
            summary,
            ``,
            `Closes #${target.issueNumber}`,
            ``,
            `---`,
            `_🦡 Implemented by fouine from issue #${target.issueNumber}. Review it like any other PR; a human approval is required before the merger will merge it._`,
          ].join("\n");
          const created = yield* Effect.tryPromise({
            try: () =>
              octokit.rest.pulls.create({
                owner,
                repo: repoName,
                title: issue.title,
                head: branch,
                base,
                body,
              }),
            catch: (cause) => new GitHubError({ op: "pulls.create", cause }),
          });
          url = created.data.html_url;
        }

        yield* gh.createIssueComment(
          octokit,
          owner,
          repoName,
          target.issueNumber,
          `🦡 Opened ${url}`,
        );
        log.info("implementer opened PR", { repo: target.repoFullName, review: id, url });
        yield* db.complete(id, result.cost, result.tokens, model, null);
      });

    const guarded = Effect.suspend(() => {
      const worktree = resolve(
        config.dataDir,
        "worktrees",
        `${target.repoFullName.replace("/", "__")}#implement-${id}`,
      );
      return run(worktree).pipe(
        Effect.ensuring(git.removeWorktree(target.repoFullName, worktree)),
      );
    });

    yield* guarded.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) return;
          const message = failureMessage(exit.cause, signal, "Superseded by a newer run");
          if (signal.aborted) {
            log.info(signal.reason === "superseded" ? "implementer superseded" : "implementer stopped", {
              repo: target.repoFullName,
              review: id,
            });
          } else {
            log.error("implementer failed", {
              repo: target.repoFullName,
              review: id,
              error: message,
            });
          }
          const current = yield* db
            .status(id)
            .pipe(Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)));
          if (current === "completed" || current === "failed") return;
          yield* writeFailure(db, id, message);
        }),
      ),
      Effect.catchAll((err) => (signal.aborted ? Effect.void : Effect.fail(err))),
    );
  });
}
