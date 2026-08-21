import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getApp, getInstallationOctokit, fetchPRInfo } from "~/github";
import { abortReviewsForPR, runReviewForPR } from "~/review";
import type { PullRequestInfo } from "~/review/types";
import { publishWebhook, upsertRepoAndPublish } from "~/server/events";
import { log } from "~/server/log";

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
        comment: { id: number; body: string };
        issue: { number: number; pull_request?: unknown };
      };
    };

    const { payload } = e;
    const fullName = payload.repository.full_name;
    const prNumber = payload.issue.number;

    if (payload.action !== "created") {
      log.debug("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        action: payload.action,
        reason: "action not created",
      });
      return;
    }
    if (!payload.issue.pull_request) {
      log.debug("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        reason: "not on a pull request",
      });
      return;
    }
    const body = payload.comment.body.trim();
    const trigger = matchTrigger(body);
    if (!trigger) {
      log.debug("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        reason: "not a fouine command",
        body: body.slice(0, 80),
      });
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
