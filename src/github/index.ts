import { App, Octokit } from "octokit";
import { config, assertGitHubConfig } from "~/config";

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

export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  return getApp().getInstallationOctokit(installationId);
}
