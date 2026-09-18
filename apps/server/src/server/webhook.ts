import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getApp, getInstallationOctokit, fetchPRInfo } from "~/github";
import {
  abortImplementsForIssue,
  abortRefinesForIssue,
  abortReviewsForPR,
  runImplement,
  runRefine,
  runReviewForPR,
} from "~/review";
import type { PullRequestInfo } from "~/review/types";
import { publishWebhook, upsertRepoAndPublish } from "~/server/events";
import { log } from "~/server/log";
import { mergeArms, repos, reviews } from "~/db";
import {
  resolveAutoMerge,
  resolveAutoReady,
  resolveImplementEnabled,
  resolveImplementLabel,
  resolveRefineEnabled,
} from "~/settings";
import { evaluateArm } from "~/merge/evaluate";
import { isBotLogin } from "~/merge/decide";

// `ready_for_review` matters: draft PRs are skipped below, so without it a PR
// opened as a draft (what `gh stack submit` does) is never reviewed at all.
const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);
// `/fouine` is the command; `/review` is a deprecated alias, kept silently
// working because a hard switch would make every `/review` comment on an
// already-open PR do nothing — no reaction, no log its author ever sees, the
// worst failure mode for a chat-triggered tool. Drop it once nobody types it.
const TRIGGERS = ["/fouine", "/review"] as const;

// The trigger a comment starts with, or undefined if it isn't one of ours.
export function matchTrigger(body: string): string | undefined {
  return TRIGGERS.find((trigger) => body.trim().startsWith(trigger));
}

// `<trigger> stop` and nothing else — an exact match on the argument, so
// `/fouine stopwatch` (or any future subcommand starting with "stop") still
// falls through to a normal review instead of silently cancelling one. Slicing
// by the matched trigger's own length matters: a hardcoded one would parse
// `/fouine stop` as `e stop`.
export function isStopCommand(body: string, trigger = matchTrigger(body)): boolean {
  if (!trigger) return false;
  return body.trim().slice(trigger.length).trim() === "stop";
}

// `<trigger> refine` and nothing else, same exact-argument rule as isStopCommand
// so `/fouine refinery` doesn't quietly trigger a refinement.
export function isRefineCommand(body: string, trigger = matchTrigger(body)): boolean {
  if (!trigger) return false;
  return body.trim().slice(trigger.length).trim() === "refine";
}

// `<trigger> implement` and nothing else, same exact-argument rule as
// isRefineCommand.
export function isImplementCommand(body: string, trigger = matchTrigger(body)): boolean {
  if (!trigger) return false;
  return body.trim().slice(trigger.length).trim() === "implement";
}

// How many refine rounds a human can trigger by just replying before fouine
// stops and asks a human to take the wheel — see refineFollowUpDecision.
const REFINE_ROUND_CAP = 3;

export type FollowUpDecision = "run" | "cap" | "skip";

// Pure decision for a comment on a TRUE issue that isn't a `/fouine` command:
// should it kick off another refine round? No GitHub/DB calls, so it's
// unit-testable against plain objects — same convention as isBotLogin/
// shouldAutoRetry.
export function refineFollowUpDecision(input: {
  authorLogin: string | undefined;
  autoReady: boolean;
  labels: string[];
  readyLabel: string;
  refineCount: number; // prior refine rows for this issue (cap marker included)
}): FollowUpDecision {
  // Without this, fouine's own refinement comment (posted by the App, i.e. a
  // bot login) would itself be a "human reply" and re-trigger refinement —
  // an infinite loop.
  if (isBotLogin(input.authorLogin, undefined)) return "skip";
  if (!input.autoReady) return "skip";
  // Already ready: the implementer may already be running. A human comment
  // must not restart refinement out from under it.
  if (input.labels.includes(input.readyLabel)) return "skip";
  // No refinement ever ran on this issue — nothing to follow up on.
  if (input.refineCount === 0) return "skip";
  // >= 4: the cap marker row (inserted by the "cap" branch below) is itself
  // counted, so a 4th-round comment lands here and stays quiet — the cap was
  // already announced once.
  if (input.refineCount >= REFINE_ROUND_CAP + 1) return "skip";
  if (input.refineCount === REFINE_ROUND_CAP) return "cap";
  return "run";
}

// Repo enabled + opted into auto-merge, read straight from the DB — no GitHub
// call needed to reject an obviously-not-eligible repo (issue: every merger
// handler short-circuits before any GitHub call when the repo isn't opted in).
function mergeEligible(fullName: string): boolean {
  const repo = repos.get.get({ $full_name: fullName });
  return !!repo && !!repo.enabled && resolveAutoMerge(repo.auto_merge);
}

// Any armed PR in this repo whose head currently matches `sha` — used by the
// events that only carry a commit SHA, not a PR number (check_run, check_suite,
// status).
function armedPRsForSha(fullName: string, sha: string): number[] {
  return mergeArms.listForRepo
    .all({ $repo: fullName })
    .filter((a) => a.head_sha === sha)
    .map((a) => a.pr_number);
}

// Best-effort ack on the triggering comment. Never throws: a failed reaction
// must not turn a successful stop into a logged error, and the abort has
// already happened by the time we get here.
async function react(
  installationId: number | undefined,
  fullName: string,
  commentId: number,
  content: "+1" | "confused",
): Promise<void> {
  if (!installationId) return;
  const [owner, repo] = fullName.split("/");
  try {
    const octokit = await getInstallationOctokit(installationId);
    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content,
    });
  } catch (err) {
    log.warn("comment reaction failed", { repo: fullName, comment: commentId, error: String(err) });
  }
}

// The follow-up path for a comment with no `/fouine` trigger on a true issue:
// maybe a human just answered the refiner's questions. Pulled out of the
// handler body so the (already long) issue_comment callback stays readable.
async function handleRefineFollowUp(
  payload: {
    installation?: { id: number };
    comment: { user?: { login: string } };
    issue: { title: string; labels?: { name: string }[] };
  },
  fullName: string,
  issueNumber: number,
): Promise<void> {
  const installationId = payload.installation?.id;
  if (!installationId) {
    log.warn("issue_comment follow-up skipped", {
      repo: fullName,
      number: issueNumber,
      reason: "no installation id",
    });
    return;
  }
  const repoRow = upsertRepoAndPublish(fullName, installationId);
  if (!repoRow.enabled) {
    log.debug("issue_comment follow-up skipped", {
      repo: fullName,
      number: issueNumber,
      reason: "repo disabled",
    });
    return;
  }
  const readyLabel = resolveImplementLabel(repoRow.implement_label);
  const refineCount =
    reviews.countRefinesForIssue.get({ $repo: fullName, $pr: issueNumber })?.count ?? 0;
  const decision = refineFollowUpDecision({
    authorLogin: payload.comment.user?.login,
    autoReady: resolveAutoReady(repoRow.auto_ready),
    labels: (payload.issue.labels ?? []).map((l) => l.name),
    readyLabel,
    refineCount,
  });

  if (decision === "skip") {
    log.debug("issue_comment follow-up skipped", {
      repo: fullName,
      number: issueNumber,
      reason: "refineFollowUpDecision: skip",
      refineCount,
    });
    return;
  }

  if (decision === "cap") {
    log.info("issue refine follow-up capped", { repo: fullName, number: issueNumber, refineCount });
    try {
      const octokit = await getInstallationOctokit(installationId);
      const [owner, repo] = fullName.split("/");
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body:
          `fouine has reached its refinement limit (${REFINE_ROUND_CAP} rounds) on this issue. ` +
          `A human should add the \`${readyLabel}\` label when it's ready, or comment ` +
          `\`/fouine refine\` to force another round.`,
      });
    } catch (err) {
      log.warn("issue refine cap comment failed", {
        repo: fullName,
        number: issueNumber,
        error: String(err),
      });
    }
    // ponytail: no dedicated "cap announced" flag/table — a fake 'failed'
    // reviews row (trigger 'refine') is the marker that keeps this comment from
    // reposting on every later human reply (it makes refineCount >= 4 forever).
    // Upgrade path: a real column/table if this fake row ever confuses the
    // dashboard's reviews list or stats.
    const row = reviews.insert.get({
      $repo: fullName,
      $pr: issueNumber,
      $title: payload.issue.title,
      $session: null,
      $status: "pending",
      $trigger: "refine",
      $attempt: 0,
    });
    if (row) {
      reviews.fail.run({
        $id: row.id,
        $error: "Refinement limit reached — a human must add the ready label",
      });
    }
    return;
  }

  // decision === "run"
  const round = refineCount + 1;
  log.info("issue refine follow-up queued", { repo: fullName, number: issueNumber, round });
  runRefine({
    repoFullName: fullName,
    installationId,
    issueNumber,
    issueTitle: payload.issue.title,
    round,
  }).catch((err) =>
    log.error("refine follow-up failed", { repo: fullName, number: issueNumber, error: String(err) }),
  );
}

let handlersRegistered = false;
export function ensureHandlers(): void {
  if (handlersRegistered) return;
  registerHandlers();
  handlersRegistered = true;
}

export function registerHandlers(): void {
  const { webhooks } = getApp();

  webhooks.on("pull_request", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        installation?: { id: number };
        repository: { full_name: string };
        pull_request: {
          number: number;
          title: string;
          body?: string;
          draft?: boolean;
          head: { ref: string; sha: string };
          base: { ref: string; sha: string };
        };
      };
    };

    const { payload } = e;
    const fullName = payload.repository.full_name;
    const number = payload.pull_request.number;

    // Merger housekeeping (#117): a closed PR drops its arm silently even
    // though "closed" isn't a review trigger below. Arming/re-arming happens
    // further down, after the draft/enabled checks, so it reuses repoRow —
    // `mergeArms.arm` replaces the row wholesale, so a `synchronize` on an
    // opted-in repo naturally re-arms on the new SHA with no separate disarm
    // step and no comment.
    if (payload.action === "closed") {
      if (mergeArms.get.get({ $repo: fullName, $pr: number })) {
        mergeArms.disarm.run({ $repo: fullName, $pr: number });
      }
    }

    if (!HANDLED_ACTIONS.has(payload.action)) {
      log.debug("pull_request skipped", {
        repo: fullName,
        number,
        action: payload.action,
        reason: "action not handled",
      });
      return;
    }
    if (payload.pull_request.draft) {
      log.debug("pull_request skipped", { repo: fullName, number, reason: "draft PR" });
      return;
    }
    const installationId = payload.installation?.id;
    if (!installationId) {
      log.warn("pull_request skipped", { repo: fullName, number, reason: "no installation id" });
      return;
    }

    const repoRow = upsertRepoAndPublish(fullName, installationId);
    if (!repoRow.enabled) {
      log.debug("pull_request skipped", { repo: fullName, number, reason: "repo disabled" });
      return;
    }

    // Arm (or re-arm) automatically for the merger (#117) — no comment
    // command. `arm` replaces the row wholesale, so `synchronize` naturally
    // re-arms on the new SHA. Not evaluated here: the review hasn't happened
    // yet, the pull_request_review handler kicks the first evaluation.
    if (resolveAutoMerge(repoRow.auto_merge)) {
      mergeArms.arm.run({
        $repo: fullName,
        $pr: number,
        $sha: payload.pull_request.head.sha,
        $by: "fouine",
      });
    }

    const pr: PullRequestInfo = {
      installationId,
      repoFullName: fullName,
      number,
      title: payload.pull_request.title,
      body: payload.pull_request.body,
      headRef: payload.pull_request.head.ref,
      baseRef: payload.pull_request.base.ref,
      headSha: payload.pull_request.head.sha,
      baseSha: payload.pull_request.base.sha,
    };

    log.info("pull_request review queued", { repo: fullName, number, action: payload.action });

    runReviewForPR(pr, payload.action).catch((err) =>
      log.error("review failed", { repo: fullName, number, error: String(err) }),
    );
  });

  webhooks.on("issue_comment", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        installation?: { id: number };
        repository: { full_name: string };
        comment: { id: number; body: string; user?: { login: string } };
        issue: {
          number: number;
          title: string;
          pull_request?: unknown;
          labels?: { name: string }[];
        };
      };
    };

    const { payload } = e;
    const fullName = payload.repository.full_name;
    const prNumber = payload.issue.number;
    const isTrueIssue = !payload.issue.pull_request;

    if (payload.action !== "created") {
      log.debug("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        action: payload.action,
        reason: "action not created",
      });
      return;
    }
    const body = payload.comment.body.trim();
    const trigger = matchTrigger(body);
    if (!trigger) {
      // No `/fouine` command: on a PR this is just discussion, nothing to do.
      // On a true issue it may still be a human answering the refiner's
      // questions — that's the follow-up path, handled on its own so it never
      // touches the PR review flow below.
      if (isTrueIssue) {
        await handleRefineFollowUp(payload, fullName, prNumber);
      } else {
        log.debug("issue_comment skipped", {
          repo: fullName,
          number: prNumber,
          reason: "not a fouine command",
          body: body.slice(0, 80),
        });
      }
      return;
    }

    // A true issue (no `pull_request` key) takes the refiner/implementer path:
    // the only commands that mean anything there are `refine`, `implement` and
    // `stop`.
    if (isTrueIssue) {
      const installationId = payload.installation?.id;
      if (isStopCommand(body, trigger)) {
        // `stop` on an issue aborts both pipelines — the caller shouldn't
        // have to know which one is running.
        const stopped =
          abortRefinesForIssue(fullName, prNumber) + abortImplementsForIssue(fullName, prNumber);
        log.info(`${trigger} stop (issue)`, { repo: fullName, number: prNumber, stopped });
        await react(installationId, fullName, payload.comment.id, stopped > 0 ? "+1" : "confused");
        return;
      }
      const wantsRefine = isRefineCommand(body, trigger);
      const wantsImplement = isImplementCommand(body, trigger);
      if (!wantsRefine && !wantsImplement) {
        log.debug("issue_comment skipped", {
          repo: fullName,
          number: prNumber,
          reason: "not a fouine command for an issue",
          body: body.slice(0, 80),
        });
        return;
      }
      const action = wantsRefine ? "refine" : "implement";
      if (!installationId) {
        log.warn(`${trigger} ${action} skipped`, {
          repo: fullName,
          number: prNumber,
          reason: "no installation id",
        });
        return;
      }
      const repoRow = upsertRepoAndPublish(fullName, installationId);
      // Deliberately not gated on refine_enabled/implement_enabled: those
      // toggles only govern the automatic triggers. Typing the command IS the
      // consent.
      if (!repoRow.enabled) {
        log.debug(`${trigger} ${action} skipped`, {
          repo: fullName,
          number: prNumber,
          reason: "repo disabled",
        });
        return;
      }
      log.info(`${trigger} ${action} queued`, { repo: fullName, number: prNumber });
      const issueTarget = {
        repoFullName: fullName,
        installationId,
        issueNumber: prNumber,
        issueTitle: payload.issue.title,
      };
      if (wantsRefine) {
        runRefine(issueTarget).catch((err) =>
          log.error("refine failed", { repo: fullName, number: prNumber, error: String(err) }),
        );
      } else {
        runImplement(issueTarget).catch((err) =>
          log.error("implement failed", { repo: fullName, number: prNumber, error: String(err) }),
        );
      }
      return;
    }

    // `/fouine stop` aborts whatever is running for this PR. The abort happens
    // before any GitHub round-trip — stopping must stay instant — and only then
    // do we tell the commenter what happened.
    if (isStopCommand(body, trigger)) {
      const stopped = abortReviewsForPR(fullName, prNumber);
      log.info(`${trigger} stop`, { repo: fullName, number: prNumber, stopped });
      await react(
        payload.installation?.id,
        fullName,
        payload.comment.id,
        // "+1" = stopped something, "confused" = nothing was running. A reaction
        // rather than a reply comment: the same ack without the PR noise.
        stopped > 0 ? "+1" : "confused",
      );
      return;
    }

    log.info(`${trigger} triggered`, { repo: fullName, number: prNumber });

    try {
      const installationId = payload.installation?.id;
      if (!installationId) {
        log.warn(`${trigger} skipped`, {
          repo: fullName,
          number: prNumber,
          reason: "no installation id",
        });
        return;
      }
      const repoRow = upsertRepoAndPublish(fullName, installationId);
      if (!repoRow.enabled) {
        log.debug(`${trigger} skipped`, { repo: fullName, number: prNumber, reason: "repo disabled" });
        return;
      }

      // Gate before the GitHub round-trips — a disabled repo costs zero API calls.
      const octokit = await getInstallationOctokit(installationId);
      const pr = await fetchPRInfo(octokit, installationId, fullName, prNumber);

      log.info(`${trigger} review queued`, { repo: fullName, number: prNumber });

      runReviewForPR(pr, "command").catch((err) =>
        log.error("review failed", { repo: fullName, number: prNumber, error: String(err) }),
      );
    } catch (err) {
      log.error(`failed to fetch PR for ${trigger}`, {
        repo: fullName,
        number: prNumber,
        error: String(err),
      });
    }
  });

  // Auto-refinement of newly opened issues, and auto-implementation of issues
  // labeled ready. Both opt-in per repo (refine_enabled / implement_enabled,
  // global fallback), default OFF — acting on every issue a project opens or
  // labels is not something to turn on for someone.
  webhooks.on("issues", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        installation?: { id: number };
        repository: { full_name: string };
        issue: { number: number; title: string; pull_request?: unknown };
        label?: { name: string };
      };
    };
    const { payload } = e;
    const fullName = payload.repository.full_name;
    const number = payload.issue.number;

    if (payload.action !== "opened" && payload.action !== "labeled") return;
    // GitHub delivers `issues` only for real issues, but the payload shape is
    // shared with issue_comment's — check anyway, a PR must never be refined
    // or implemented.
    if (payload.issue.pull_request) return;
    const installationId = payload.installation?.id;
    if (!installationId) {
      log.warn("issues skipped", { repo: fullName, number, reason: "no installation id" });
      return;
    }
    const repoRow = upsertRepoAndPublish(fullName, installationId);
    if (!repoRow.enabled) {
      log.debug("issues skipped", { repo: fullName, number, reason: "repo disabled" });
      return;
    }

    if (payload.action === "opened") {
      if (!resolveRefineEnabled(repoRow.refine_enabled)) {
        log.debug("issues skipped", { repo: fullName, number, reason: "refine disabled" });
        return;
      }
      log.info("issue refine queued", { repo: fullName, number });
      runRefine({
        repoFullName: fullName,
        installationId,
        issueNumber: number,
        issueTitle: payload.issue.title,
      }).catch((err) => log.error("refine failed", { repo: fullName, number, error: String(err) }));
      return;
    }

    // labeled
    // No check on payload.sender/author here, deliberately: fouine's own
    // refiner adds this label itself (via mark_issue_ready) when auto_ready is
    // on, and it must fire the implementer exactly like a human labeling it
    // would. implement_enabled (checked just below) still gates the
    // implementer either way — auto_ready alone only labels the issue.
    if (payload.label?.name !== resolveImplementLabel(repoRow.implement_label)) {
      log.debug("issues skipped", { repo: fullName, number, reason: "not the implement label" });
      return;
    }
    if (!resolveImplementEnabled(repoRow.implement_enabled)) {
      log.debug("issues skipped", { repo: fullName, number, reason: "implement disabled" });
      return;
    }
    log.info("issue implement queued", { repo: fullName, number });
    runImplement({
      repoFullName: fullName,
      installationId,
      issueNumber: number,
      issueTitle: payload.issue.title,
    }).catch((err) =>
      log.error("implement failed", { repo: fullName, number, error: String(err) }),
    );
  });

  // The four merger re-evaluation triggers (#117). Every one short-circuits on
  // local DB reads alone (mergeEligible / armedPRsForSha) before evaluateArm
  // makes its first GitHub call.

  webhooks.on("pull_request_review", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        repository: { full_name: string };
        pull_request: { number: number };
      };
    };
    const { payload } = e;
    if (payload.action !== "submitted") return;
    const fullName = payload.repository.full_name;
    const number = payload.pull_request.number;
    if (!mergeEligible(fullName)) return;
    if (!mergeArms.get.get({ $repo: fullName, $pr: number })) return;
    evaluateArm(fullName, number);
  });

  webhooks.on("check_run", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        repository: { full_name: string };
        check_run: { head_sha: string };
      };
    };
    const { payload } = e;
    if (payload.action !== "completed") return;
    const fullName = payload.repository.full_name;
    if (!mergeEligible(fullName)) return;
    for (const number of armedPRsForSha(fullName, payload.check_run.head_sha)) {
      evaluateArm(fullName, number);
    }
  });

  webhooks.on("check_suite", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        action: string;
        repository: { full_name: string };
        check_suite: { head_sha: string };
      };
    };
    const { payload } = e;
    if (payload.action !== "completed") return;
    const fullName = payload.repository.full_name;
    if (!mergeEligible(fullName)) return;
    for (const number of armedPRsForSha(fullName, payload.check_suite.head_sha)) {
      evaluateArm(fullName, number);
    }
  });

  webhooks.on("status", async (event: EmitterWebhookEvent) => {
    const e = event as unknown as {
      payload: {
        repository: { full_name: string };
        sha: string;
      };
    };
    const { payload } = e;
    const fullName = payload.repository.full_name;
    if (!mergeEligible(fullName)) return;
    for (const number of armedPRsForSha(fullName, payload.sha)) {
      evaluateArm(fullName, number);
    }
  });
}

export async function verifyAndDispatch(opts: {
  id: string;
  name: string;
  payload: string;
  signature: string | null;
}): Promise<void> {
  const { webhooks } = getApp();
  ensureHandlers();

  log.info("webhook received", {
    delivery: opts.id,
    event: opts.name,
    signed: !!opts.signature,
    bytes: opts.payload.length,
  });

  if (!opts.signature) {
    log.warn("webhook rejected", {
      delivery: opts.id,
      event: opts.name,
      reason: "no signature header",
    });
    throw new VerificationError();
  }
  if (!(await webhooks.verify(opts.payload, opts.signature))) {
    log.warn("webhook rejected", {
      delivery: opts.id,
      event: opts.name,
      reason: "signature mismatch (check GITHUB_WEBHOOK_SECRET)",
    });
    throw new VerificationError();
  }

  log.info("webhook verified", { delivery: opts.id, event: opts.name });

  publishWebhook(opts.name, opts.id, opts.payload);

  await webhooks.verifyAndReceive({
    id: opts.id,
    name: opts.name,
    payload: opts.payload,
    signature: opts.signature,
  });
}

export class VerificationError extends Error {
  status = 401;
  constructor() {
    super("Invalid webhook signature");
  }
}
