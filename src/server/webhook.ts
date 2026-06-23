import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { repos } from "~/db";
import { getApp } from "~/github";
import { runReviewForPR } from "~/review";
import type { PullRequestInfo } from "~/review/types";

const HANDLED_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

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

    console.log(
      `[webhook] pull_request.${payload.action} ${fullName}#${pr.number}`,
    );

    runReviewForPR(pr).catch((err) =>
      console.error(`[webhook] review failed for ${fullName}#${pr.number}:`, err),
    );
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
