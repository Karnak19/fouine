import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { repos } from "~/db";
import { getApp, getInstallationOctokit } from "~/github";
import { runReviewForPR } from "~/review";
import type { PullRequestInfo } from "~/review/types";
import { log } from "~/server/log";

const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened"]);
const TRIGGER = "/review";

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
    const installationId = payload.installation?.id;
    if (!installationId) {
      log.warn("pull_request skipped", { repo: fullName, number, reason: "no installation id" });
      return;
    }

    repos.upsert.run({
      $full_name: fullName,
      $installation_id: installationId,
      $prompt: null,
      $model: null,
    });

    const pr: PullRequestInfo = {
      installationId,
      repoFullName: fullName,
      number,
      title: payload.pull_request.title,
      headRef: payload.pull_request.head.ref,
      baseRef: payload.pull_request.base.ref,
      headSha: payload.pull_request.head.sha,
      baseSha: payload.pull_request.base.sha,
    };

    log.info("pull_request review queued", { repo: fullName, number, action: payload.action });

    runReviewForPR(pr).catch((err) =>
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

    const installationId = payload.installation?.id;
    if (!installationId) {
      log.warn("issue_comment skipped", {
        repo: fullName,
        number: prNumber,
        reason: "no installation id",
      });
      return;
    }

    log.info("/review triggered", { repo: fullName, number: prNumber });

    try {
      const octokit = await getInstallationOctokit(installationId);
      const { data: prData } = await (octokit as any).rest.pulls.get({
        owner: fullName.split("/")[0],
        repo: fullName.split("/")[1],
        pull_number: prNumber,
      });

      const pr: PullRequestInfo = {
        installationId,
        repoFullName: fullName,
        number: prNumber,
        title: prData.title,
        headRef: prData.head.ref,
        baseRef: prData.base.ref,
        headSha: prData.head.sha,
        baseSha: prData.base.sha,
      };

      repos.upsert.run({
        $full_name: fullName,
        $installation_id: installationId,
        $prompt: null,
        $model: null,
      });

      log.info("/review review queued", { repo: fullName, number: prNumber });

      runReviewForPR(pr).catch((err) =>
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
