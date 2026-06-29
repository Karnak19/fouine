import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { repos } from "~/db";
import { getApp, getInstallationOctokit } from "~/github";
import { runReviewForPR } from "~/review";
import type { PullRequestInfo } from "~/review/types";

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
    if (!HANDLED_ACTIONS.has(payload.action)) return;
    const installationId = payload.installation?.id;
    if (!installationId) return;

    const fullName = payload.repository.full_name;
    repos.upsert.run({
      $full_name: fullName,
      $installation_id: installationId,
      $prompt: null,
      $model: null,
    });

    const pr: PullRequestInfo = {
      installationId,
      repoFullName: fullName,
      number: payload.pull_request.number,
      title: payload.pull_request.title,
      headRef: payload.pull_request.head.ref,
      baseRef: payload.pull_request.base.ref,
      headSha: payload.pull_request.head.sha,
      baseSha: payload.pull_request.base.sha,
    };

    console.log(`[webhook] pull_request.${payload.action} ${fullName}#${pr.number}`);

    runReviewForPR(pr).catch((err) =>
      console.error(`[webhook] review failed for ${fullName}#${pr.number}:`, err),
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
    if (payload.action !== "created") return;
    if (!payload.issue.pull_request) return;
    if (!payload.comment.body.trim().startsWith(TRIGGER)) return;

    const installationId = payload.installation?.id;
    if (!installationId) return;

    const fullName = payload.repository.full_name;
    const prNumber = payload.issue.number;

    console.log(`[webhook] /review triggered on ${fullName}#${prNumber}`);

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

      runReviewForPR(pr).catch((err) =>
        console.error(`[webhook] review failed for ${fullName}#${prNumber}:`, err),
      );
    } catch (err) {
      console.error(`[webhook] failed to fetch PR ${fullName}#${prNumber}:`, err);
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
  if (!opts.signature || !(await webhooks.verify(opts.payload, opts.signature))) {
    throw new VerificationError();
  }
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
