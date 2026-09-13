import { Effect } from "effect";
import type { Octokit } from "octokit";
import type { ReviewRow } from "@fouine/shared";
import { config } from "~/config";
import { log } from "~/server/log";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import type { DatabaseError, GitHubError } from "~/effect/errors";

// How long past the review watchdog's absolute ceiling an in-flight row may sit
// before the reconciler declares it wedged. Derived from the same config so a
// raised REVIEW_TIMEOUT_MS moves this tripwire with it.
const STALE_MARGIN_MS = 15 * 60 * 1000;

// Terminal rows are only worth re-verifying while their checks could plausibly
// still be open — a week bounds the GitHub API traffic to recent history.
const VERIFY_WINDOW_SEC = 7 * 24 * 60 * 60;
const VERIFY_LIMIT = 100;

export const STALE_MESSAGE =
  "Stale review reconciled: still unfinished past the watchdog ceiling, nothing will ever finish it";

const splitRepo = (fullName: string): [string, string] => {
  const [owner, name] = fullName.split("/");
  return [owner ?? fullName, name ?? ""];
};

// Conclusion for a wedged run's check: the check represents "the review reached
// the PR" — if findings were posted the deliverable exists (success), otherwise
// the run produced nothing (failure). The DB row is failed either way: the
// pipeline never completed.
const staleConclusion = (posted: boolean): "success" | "failure" =>
  posted ? "success" : "failure";

const staleSummary = (posted: boolean): string =>
  posted
    ? "Review posted, but fouine's pipeline never finished its bookkeeping, so this run stayed " +
      "in progress. Closed by the stale-check reconciler — no action needed."
    : "The review never completed and nothing was posted. Closed by the stale-check reconciler.";

const terminalSummary = (status: string): string =>
  `The review row is already ${status}, but this run was still open. Closed by the stale-check reconciler.`;

// Resolve the repo's current installation client. Null when the repo row is
// gone (deleted) — the caller then settles the DB row but has no check to close.
function clientFor(
  db: DbService,
  gh: GitHubService,
  repoFullName: string,
): Effect.Effect<Octokit | null, DatabaseError | GitHubError> {
  return Effect.gen(function* () {
    const repo = yield* db.getRepo(repoFullName);
    if (!repo) return null;
    return yield* gh.installationClient(repo.installation_id);
  });
}

// One wedged row: fail it, then close its check if there is one. Never fails —
// a single bad row must not abort the sweep; the error is logged and the next
// tick retries what was left behind.
function settleStaleRow(
  db: DbService,
  gh: GitHubService,
  row: ReviewRow,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* db.fail(row.id, STALE_MESSAGE);
    if (row.pr_number <= 0 || row.check_run_id == null) return;
    const octokit = yield* clientFor(db, gh, row.repo_full_name);
    if (!octokit) return;
    const posted = yield* db.hasFindings(row.id);
    const [owner, name] = splitRepo(row.repo_full_name);
    const closed = yield* gh.finishCheck(
      octokit,
      owner,
      name,
      row.check_run_id,
      staleConclusion(posted),
      staleSummary(posted),
    );
    log.info("stale check run reconciled", {
      review: row.id,
      repo: row.repo_full_name,
      posted,
      closed,
    });
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.sync(() =>
        log.warn("stale row reconcile failed, will retry next tick", {
          review: row.id,
          error: String(cause),
        }),
      ),
    ),
  );
}

// One terminal row: close its check only if GitHub still shows it open. Never
// fails, same reason as above.
function verifyTerminalRow(
  db: DbService,
  gh: GitHubService,
  row: ReviewRow,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (row.check_run_id == null) return;
    const octokit = yield* clientFor(db, gh, row.repo_full_name);
    if (!octokit) return;
    const [owner, name] = splitRepo(row.repo_full_name);
    const state = yield* gh.checkStatus(octokit, owner, name, row.check_run_id);
    if (state !== "open") return;
    const closed = yield* gh.finishCheck(
      octokit,
      owner,
      name,
      row.check_run_id,
      row.status === "failed" ? "failure" : "success",
      terminalSummary(row.status),
    );
    log.info("terminal check run still open, closed it", {
      review: row.id,
      repo: row.repo_full_name,
      status: row.status,
      closed,
    });
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.sync(() =>
        log.warn("terminal row verify failed, will retry next tick", {
          review: row.id,
          error: String(cause),
        }),
      ),
    ),
  );
}

// Hourly backstop for every way a check run can be left open: a finishCheck
// that hung or failed after the row settled (only GitHub-side verification
// finds those), and an in-flight row no legitimate fiber can still own (past
// the watchdog ceiling — wedged pre-completion or orphaned by a restart the
// boot reaper couldn't close). Runs at boot too, so a deploy heals whatever is
// currently stuck.
export function reconcileStaleChecks(
  nowSec: number = Math.floor(Date.now() / 1000),
): Effect.Effect<void, DatabaseError, DbService | GitHubService> {
  return Effect.gen(function* () {
    const db = yield* DbService;
    const gh = yield* GitHubService;

    const staleCutoff = nowSec - Math.ceil((config.review.timeoutMs + STALE_MARGIN_MS) / 1000);
    const stale = yield* db.staleUnfinished(staleCutoff);
    for (const row of stale) yield* settleStaleRow(db, gh, row);

    const terminal = yield* db.terminalWithCheck(nowSec - VERIFY_WINDOW_SEC, VERIFY_LIMIT);
    for (const row of terminal) yield* verifyTerminalRow(db, gh, row);

    if (stale.length > 0 || terminal.length > 0) {
      log.info("stale-check reconcile done", {
        staleRows: stale.length,
        terminalChecked: terminal.length,
      });
    }
  });
}
