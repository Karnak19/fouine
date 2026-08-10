import { Cause, Effect, Exit, Option, Ref } from "effect";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Octokit } from "octokit";
import type { PullRequestInfo } from "~/review/types";
import { buildPrompt } from "~/review/prompt";
import { resolveDefaultModel, resolvePrompt } from "~/settings";
import { log } from "~/server/log";
import { config } from "~/config";
import { internalSecret, internalBaseUrl } from "~/server/internal";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { reviewToolEnv } from "~/review/opencode";
import { type ReviewError } from "~/effect/errors";

export function cloneUrl(token: string, fullName: string): string {
  return `https://x-access-token:${token}@github.com/${fullName}.git`;
}

// Repo-local REVIEW.md if the repo ships one — additive guidance. Never fails.
// Also read by the improver pipeline as the file it proposes updates to.
export const readRepoNotes = (worktree: string): Effect.Effect<string | undefined> =>
  Effect.tryPromise(() => readFile(resolve(worktree, "REVIEW.md"), "utf8")).pipe(
    Effect.map((s) => s.trim() || undefined),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );

// Turn whatever ended the run into the one-line message the dashboard shows.
// Three channels have to be covered, not just the typed one (#60): a typed
// ReviewError, a defect (an unexpected throw anywhere in the gen body), and an
// interrupt. Anything we can't name still gets a message — a row must never be
// left at running/pending because we didn't recognise the failure.
export function failureMessage(
  cause: Cause.Cause<ReviewError>,
  signal: AbortSignal,
  supersededLabel: string,
): string {
  if (signal.aborted) return signal.reason === "superseded" ? supersededLabel : "Stopped by user";
  if (Cause.isInterruptedOnly(cause)) return "Interrupted";
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return String(failure.value.cause);
  return String(Cause.squash(cause));
}

// The status write is the whole point of the failure path, so its own failure
// can't be swallowed silently the way it used to be — a locked DB there means a
// zombie row that the log claims is failed.
export function writeFailure(
  db: DbService,
  id: number,
  message: string,
): Effect.Effect<void> {
  return db.fail(id, message).pipe(
    Effect.catchAll((err) =>
      Effect.sync(() =>
        log.error("FAILED to write review failure status — row may be stuck", {
          review: id,
          message,
          error: String(err.cause),
        }),
      ),
    ),
  );
}

// The full review as one typed Effect. `signal` comes from the runner's
// AbortController (dashboard Stop button); the opencode SDK observes it and an
// abort surfaces as a failure that the handler recognises via signal.aborted.
export function reviewPipeline(
  pr: PullRequestInfo,
  trigger: string | null,
  signal: AbortSignal,
  // Called once the review row exists, so the runner can register its
  // AbortController in the live-reviews map (keyed by this id) before the long
  // git/opencode work starts.
  onStart: (id: number) => void,
): Effect.Effect<
  void,
  ReviewError,
  DbService | GitHubService | GitService | OpenCodeService
> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;
    const git = yield* GitService;
    const oc = yield* OpenCodeService;

    const repo = yield* db.getRepo(pr.repoFullName);
    const id = yield* db.insertReview({
      repo: pr.repoFullName,
      pr: pr.number,
      title: pr.title,
      trigger,
    });
    yield* Effect.sync(() => onStart(id));

    const [owner, repoName] = pr.repoFullName.split("/");

    // Held so the failure handler can finish the check even though octokit /
    // checkRunId are only acquired partway through the run.
    const octokitRef = yield* Ref.make<Octokit | undefined>(undefined);
    const checkRef = yield* Ref.make<number | undefined>(undefined);
    // Set only once the check run is actually finalised, so the failure handler
    // can tell "already closed" from "still in progress" — the row being
    // terminal doesn't imply the check was closed (finishCheck can throw after
    // db.complete succeeded).
    const checkDoneRef = yield* Ref.make(false);

    const run = (worktree: string) =>
      Effect.gen(function* () {
        log.info("review starting", { repo: pr.repoFullName, number: pr.number, review: id });
        yield* db.setRunning(id);

        const octokit = yield* gh.installationClient(pr.installationId);
        yield* Ref.set(octokitRef, octokit);
        const checkRunId = yield* gh.startCheck(octokit, owner, repoName, pr.headSha);
        yield* Ref.set(checkRef, checkRunId);
        // Persisted immediately: if the process dies from here on, the boot
        // reaper needs this exact id to close the run it left in progress.
        if (checkRunId !== undefined) yield* db.setCheckRun(id, checkRunId);
        const token = yield* gh.installationToken(octokit);

        yield* git.ensureBare(pr.repoFullName, cloneUrl(token, pr.repoFullName));
        yield* git.fetchRef(pr.repoFullName, `refs/pull/${pr.number}/head`);
        yield* git.addWorktree(pr.repoFullName, pr.headSha, worktree);
        log.info("worktree ready", { repo: pr.repoFullName, number: pr.number, path: worktree });

        const repoNotes = yield* readRepoNotes(worktree);
        // Anything but a brand-new "opened" run may have prior reviews to reconcile
        // with — tell the agent to pull them via get_prior_reviews.
        const reReview = trigger != null && trigger !== "opened";
        const prompt = buildPrompt(pr, resolvePrompt(repo?.prompt ?? null), repoNotes, reReview);
        const model = repo?.model ?? resolveDefaultModel();

        // Custom tools (opencode-config/tools) read these to post to GitHub, then
        // write the findings back to us over the loopback FOUINE_INTERNAL_* channel
        // so the dashboard has a structured record (not just the transcript). Passed
        // as per-review env (isolated at subprocess spawn) rather than mutated onto
        // the shared process.env, so concurrent reviews stay isolated (#23).
        const toolEnv = reviewToolEnv({
          githubToken: token,
          owner,
          repo: repoName,
          prNumber: pr.number,
          reviewId: id,
          internalUrl: internalBaseUrl,
          internalSecret,
        });

        const result = yield* oc.runReview(
          {
            directory: worktree,
            prompt,
            model,
            // Fixed output-structure + posting rules live in this agent's system
            // prompt, so they survive any per-repo prompt override.
            agent: "fouine",
            env: toolEnv,
            // Sync SQLite read, same runSync bridge as setSession below. On a DB
            // error assume posted — better to miss a nudge than nudge a review
            // that's already on GitHub.
            hasPosted: () =>
              Effect.runSync(db.hasFindings(id).pipe(Effect.catchAll(() => Effect.succeed(true)))),
          },
          // Persist the session id as soon as it exists so the dashboard can
          // stream `opencode export` mid-flight. setSession is a sync SQLite
          // write, so runSync completes it in place like the old callback.
          (sessionId) =>
            Effect.runSync(db.setSession(id, sessionId).pipe(Effect.catchAll(() => Effect.void))),
          signal,
        );

        log.info("review done", {
          repo: pr.repoFullName,
          number: pr.number,
          review: id,
          session: result.sessionId,
          textChars: result.text.length,
          preview: result.text.slice(0, 500),
        });
        yield* db.complete(id, result.cost, result.tokens, model);
        yield* gh.finishCheck(octokit, owner, repoName, checkRunId, "success", result.text);
        yield* Ref.set(checkDoneRef, true);
      });

    // Everything from here on is covered by the finaliser below — including the
    // worktree path computation, which used to sit in the outer gen where a
    // throw would have stranded the row at `pending`.
    const guarded = Effect.suspend(() => {
      const worktree = resolve(
        config.dataDir,
        "worktrees",
        `${pr.repoFullName.replace("/", "__")}#${pr.number}-${id}`,
      );
      // Guaranteed cleanup on success, failure, or interruption.
      return run(worktree).pipe(Effect.ensuring(git.removeWorktree(pr.repoFullName, worktree)));
    });

    yield* guarded.pipe(
      // onExit, not catchAll: catchAll only sees the typed ReviewError channel,
      // so a defect or an interrupt used to sail past it and leave the row at
      // `running` forever (#60). The finaliser runs uninterruptibly, so the
      // status write survives even a fiber interrupt.
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) return;
          // An abort isn't an error — don't pollute error monitoring. A newer
          // commit superseding the run is signalled via AbortSignal.reason.
          const aborted = signal.aborted;
          const message = failureMessage(exit.cause, signal, "Superseded by a newer commit");
          if (aborted) {
            log.info(signal.reason === "superseded" ? "review superseded" : "review stopped", {
              repo: pr.repoFullName,
              number: pr.number,
              review: id,
            });
          } else {
            log.error("review failed", {
              repo: pr.repoFullName,
              number: pr.number,
              review: id,
              error: message,
            });
          }
          // The success path already wrote `completed` (and may have failed
          // afterwards) — never overwrite a settled row with a failure. On a
          // read error we still attempt the write: a duplicate `failed` is
          // better than a row stuck at `running`.
          const current = yield* db
            .status(id)
            .pipe(Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)));
          const settled = current === "completed" || current === "failed";
          if (!settled) yield* writeFailure(db, id, message);

          // Independent of the row status: db.complete can succeed and the
          // *following* finishCheck still throw, which would otherwise leave the
          // check run in_progress forever on a terminal row. checkDoneRef is the
          // only reliable signal that it was closed. Best-effort — a failure
          // here must not fail the finaliser and mask the original cause.
          const octokit = yield* Ref.get(octokitRef);
          const checkDone = yield* Ref.get(checkDoneRef);
          if (octokit && !checkDone) {
            const checkRunId = yield* Ref.get(checkRef);
            yield* gh
              .finishCheck(octokit, owner, repoName, checkRunId, "failure", message)
              .pipe(
                Effect.catchAll((cause) =>
                  Effect.sync(() =>
                    log.error("failed to close check run — it may stay in progress", {
                      repo: pr.repoFullName,
                      number: pr.number,
                      review: id,
                      error: String(cause),
                    }),
                  ),
                ),
              );
          }
        }),
      ),
      // Intentional stop → succeed (swallow). Real failure → propagate so the
      // caller's .catch logs it, as the old `throw err` did.
      Effect.catchAll((err) => (signal.aborted ? Effect.void : Effect.fail(err))),
    );
  });
}
