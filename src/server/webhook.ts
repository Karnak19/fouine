import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getApp, getInstallationOctokit, fetchPRInfo } from "~/github";
import { runReviewForPR } from "~/review";
import type { PullRequestInfo } from "~/review/types";
import { publishWebhook, upsertRepoAndPublish } from "~/server/events";
import { log } from "~/server/log";
import { resolveTriggers } from "~/settings";

const TRIGGER = "/review";

// The configurable half of the pull_request gate, pulled out so it can be
// tested directly — dispatching a real webhook to exercise it would queue an
// actual review. Returns null to proceed, or the skip reason to log. The repo's
// own rules win over the global ones; both fall back to the defaults.
export function triggerSkipReason(
  repoTriggers: string | null,
  action: string,
  draft: boolean | undefined,
): string | null {
  const triggers = resolveTriggers(repoTriggers);
  if (!(triggers.actions as readonly string[]).includes(action)) return "action not handled";
  if (draft && !triggers.reviewDrafts) return "draft PR";
  return null;
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

    // The trigger rules can be overridden per repo, so the repo row has to be
    // fetched before the action/draft checks — which is why the installation and
    // enabled gates now come first. Everything still exits through a
    // log.debug/warn with a reason: those lines are the only way to work out
    // from the outside why a PR wasn't reviewed.
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

    const skip = triggerSkipReason(repoRow.triggers, payload.action, payload.pull_request.draft);
    if (skip) {
      log.debug("pull_request skipped", {
        repo: fullName,
        number,
        action: payload.action,
        reason: skip,
      });
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
        comment: { body: string };
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
    if (!body.startsWith(TRIGGER)) {
      log.debug("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        reason: "no /review trigger",
        body: body.slice(0, 80),
      });
      return;
    }

    // No trigger-rule check here, deliberately: `/review` is a human asking for
    // a review on this PR right now. It works on drafts and on repos whose rules
    // exclude every automatic action — an explicit command beats the config.
    log.info("/review triggered", { repo: fullName, number: prNumber });

    try {
      const installationId = payload.installation?.id;
      if (!installationId) {
        log.warn("/review skipped", {
          repo: fullName,
          number: prNumber,
          reason: "no installation id",
        });
        return;
      }
      const repoRow = upsertRepoAndPublish(fullName, installationId);
      if (!repoRow.enabled) {
        log.debug("/review skipped", { repo: fullName, number: prNumber, reason: "repo disabled" });
        return;
      }

      // Gate before the GitHub round-trips — a disabled repo costs zero API calls.
      const octokit = await getInstallationOctokit(installationId);
      const pr = await fetchPRInfo(octokit, installationId, fullName, prNumber);

      log.info("/review review queued", { repo: fullName, number: prNumber });

      runReviewForPR(pr, "command").catch((err) =>
        log.error("review failed", { repo: fullName, number: prNumber, error: String(err) }),
      );
    } catch (err) {
      log.error("failed to fetch PR for /review", {
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
