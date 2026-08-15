import { App, Octokit } from "octokit";
import { config, assertGitHubConfig } from "~/config";
import type { PullRequestInfo } from "~/review/types";

let app: App | undefined;

export function getApp(): App {
  if (app) return app;
  assertGitHubConfig();
  app = new App({
    appId: config.github.appId!,
    privateKey: config.github.privateKey!,
    webhooks: { secret: config.github.webhookSecret! },
  });
  return app;
}

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  return getApp().getInstallationOctokit(installationId);
}

export async function fetchPRInfo(
  octokit: Octokit,
  installationId: number,
  fullName: string,
  number: number,
): Promise<PullRequestInfo> {
  const [owner, repo] = fullName.split("/");
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  return {
    installationId,
    repoFullName: fullName,
    number,
    title: data.title,
    body: data.body ?? "",
    headRef: data.head.ref,
    baseRef: data.base.ref,
    headSha: data.head.sha,
    baseSha: data.base.sha,
  };
}
