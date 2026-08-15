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
import { installDeps } from "~/effect/install";
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
  // Called once we've decided this push really needs reviewing, just before the
  // expensive work starts. The runner supersedes the PR's in-flight review here
  // rather than up front (issue trap 3): if we superseded first and then skipped,
  // we'd have killed a real review and put nothing in its place. The price is
  // that the previous review keeps running for the few seconds the fetch and the
  // patch-id take.
  onProceed: (id: number) => void,
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
    // Set only once the check run is actually finalised, so the finaliser can
    // tell "already closed" from "still in progress" — neither the row being
    // terminal nor finishCheck returning implies the check was closed, since
    // finishCheck swallows its own API errors.
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

        // The skip decision sits here on purpose: after the bare fetch (which we
        // need anyway to see the commits) and before the worktree, the install
        // and the model call — those are the cost. Everything above this point is
        // cheap and local.
        const patch = yield* git.patchId(pr.repoFullName, pr.baseRef, pr.headSha, id);
        // Explicit human triggers always review — someone asking after a rebase
        // has a reason, and we must not second-guess it.
        const forced = trigger === "command" || trigger === "retry";
        const baseline = !forced && patch ? yield* db.lastReviewedPatch(pr.repoFullName, pr.number) : null;
        if (baseline && baseline.patch_id === patch) {
          log.info("review skipped", {
            repo: pr.repoFullName,
            number: pr.number,
            review: id,
            matched: baseline.id,
            patch,
          });
          yield* db.skip(id, patch);
          // The check MUST be completed with a conclusion. A silent skip leaves
          // `fouine` pending forever, and once the check is required in branch
          // protection (#24) the PR becomes permanently unmergeable.
          const closed = yield* gh.finishCheck(
            octokit,
            owner,
            repoName,
            checkRunId,
            "success",
            `No review needed — this push does not change the diff.\n\nThe diff is byte-identical (patch-id \`${patch}\`) to the one already reviewed in review #${baseline.id}. A rebase or a merge of the base branch moves the commits, not the content.`,
          );
          yield* Ref.set(checkDoneRef, closed);
          // Clean return = success, so the outer onExit finaliser (failure-only
          // for the row write) leaves the `skipped` row alone.
          return;
        }
        yield* Effect.sync(() => onProceed(id));

        yield* git.addWorktree(pr.repoFullName, pr.headSha, worktree);
        log.info("worktree ready", { repo: pr.repoFullName, number: pr.number, path: worktree });

        const repoNotes = yield* readRepoNotes(worktree);

        // Before the session, never during it: the agent has no node_modules to
        // work with otherwise, and an agent-run `bun install` executes the PR's
        // postinstall scripts with our tokens in env. Best-effort by
        // construction — installDeps never fails, so a dead registry degrades
        // the review instead of killing it. `signal` so /review stop and a
        // superseding commit interrupt an install that's still going.
        yield* installDeps(worktree, signal);

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
            // Live transcript: deltas go out on the SSE hub scoped to this
            // repo, so the detail page streams instead of re-exporting the
            // whole session (which spawns an opencode server per request).
            transcript: { reviewId: id, repo: pr.repoFullName },
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
        // `patch` is the baseline a future rebase-only push will match against —
        // null when the patch-id was unavailable, which just means no skipping.
        yield* db.complete(id, result.cost, result.tokens, model, patch ?? null);
        // finishCheck swallows its own API errors, so its *return value* — not
        // the fact that it returned — is the only signal the run was closed.
        const closed = yield* gh.finishCheck(
          octokit,
          owner,
          repoName,
          checkRunId,
          "success",
          result.text,
        );
        yield* Ref.set(checkDoneRef, closed);
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
          const failed = Exit.isFailure(exit);
          // An abort isn't an error — don't pollute error monitoring. A newer
          // commit superseding the run is signalled via AbortSignal.reason.
          const aborted = signal.aborted;
          const message = failed
            ? failureMessage(exit.cause, signal, "Superseded by a newer commit")
            : "";

          // The DB failure write stays failure-only: a review that succeeded is
          // never reported as failed, whatever happened to its check run.
          if (failed) {
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
          }

          // Runs on BOTH outcomes, independent of the row status: finishCheck
          // swallows its own errors, so a review can succeed end to end while
          // GitHub never heard the check was done. checkDoneRef is the only
          // reliable signal that it was closed; if it wasn't, retry here — as a
          // success when the review really did succeed, as a failure otherwise.
          // Best-effort: a failure here must not fail the finaliser and mask the
          // original cause.
          const octokit = yield* Ref.get(octokitRef);
          const checkDone = yield* Ref.get(checkDoneRef);
          const checkRunId = yield* Ref.get(checkRef);
          if (octokit && !checkDone && checkRunId !== undefined) {
            yield* gh
              .finishCheck(
                octokit,
                owner,
                repoName,
                checkRunId,
                failed ? "failure" : "success",
                failed ? message : "Review completed.",
              )
              .pipe(
                // catchAllCause, not catchAll: finishCheck has no typed error
                // channel left, but a defect here must still not mask the
                // original cause.
                Effect.catchAllCause((cause) =>
                  Effect.sync(() =>
                    log.error("failed to close check run — it may stay in progress", {
                      repo: pr.repoFullName,
                      number: pr.number,
                      review: id,
                      error: String(Cause.squash(cause)),
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
