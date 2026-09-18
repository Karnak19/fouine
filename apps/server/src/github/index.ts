import { App, Octokit } from "octokit";
import { config, assertGitHubConfig } from "~/config";
import type { IssueInfo, PullRequestInfo } from "~/review/types";

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

// The refiner's context window is the budget here, not GitHub's: an issue with
// hundreds of comments would drown the prompt, and a pasted stack trace can be
// megabytes.
const MAX_COMMENTS = 30;
const MAX_BODY = 8000;

const truncate = (text: string): string =>
  text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n\n_(truncated)_" : text;

export async function fetchIssueInfo(
  octokit: Octokit,
  fullName: string,
  number: number,
): Promise<IssueInfo> {
  const [owner, repo] = fullName.split("/");
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
  // ponytail: first page only, keep the last MAX_COMMENTS. The endpoint has no
  // sort param and returns oldest-first, and the tail is where the current
  // state of a discussion lives. Paginate if 100-comment issues ever matter.
  const { data: raw } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
  return {
    repoFullName: fullName,
    number,
    title: data.title,
    body: truncate(data.body ?? ""),
    comments: raw
      .slice(-MAX_COMMENTS)
      .map((c) => ({ author: c.user?.login ?? "unknown", body: truncate(c.body ?? "") })),
  };
}
