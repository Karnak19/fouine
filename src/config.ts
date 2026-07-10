import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readKey(): string | undefined {
  const path = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path) return readFileSync(path, "utf8").trim();
  return process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
}

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  dbPath: resolve(process.env.DB_PATH ?? `${dataDir}/fouine.db`),
  reposDir: resolve(`${dataDir}/repos`),
  github: {
    appId: process.env.GITHUB_APP_ID,
    privateKey: readKey(),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  opencode: {
    apiKey: process.env.OPENCODE_API_KEY,
  },
  review: {
    defaultModel: process.env.OPENCODE_MODEL ?? "opencode-go/glm-5.2",
    timeoutMs: Number(process.env.REVIEW_TIMEOUT_MS ?? 10 * 60 * 1000),
  },
  // GitHub OAuth login for the dashboard. Disabled (no login required) unless a
  // secret + OAuth client id/secret are all set — mirrors the old Basic Auth
  // "leave empty to disable" behaviour for local dev. allowedUsers gates which
  // GitHub accounts may sign in (comma-separated logins, case-insensitive).
  auth: {
    secret: process.env.BETTER_AUTH_SECRET,
    // Public origin of the app, e.g. https://fouine.example.com. Used as the
    // OAuth callback base; falls back to localhost for dev.
    url: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    // The existing fouine GitHub App's OAuth credentials (App settings >
    // General > Client ID / a generated client secret) — reused for login so
    // there's no second app. The App must grant Account > Email addresses
    // (read-only), since GitHub Apps derive email from permissions, not scope.
    githubClientId: process.env.GITHUB_APP_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
    allowedUsers: (process.env.ALLOWED_GITHUB_USERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    get enabled(): boolean {
      return !!(this.secret && this.githubClientId && this.githubClientSecret);
    },
  },
} as const;

export type Config = typeof config;

export function assertGitHubConfig(): void {
  const missing = Object.entries(config.github)
    .filter(([, v]) => !v)
    .map(([k]) => `GITHUB_${k.replace(/([A-Z])/g, "_$1").toUpperCase()}`);
  if (missing.length) {
    throw new Error(
      `Missing GitHub App configuration: ${missing.join(", ")}. ` +
        `Set these env vars before receiving webhooks.`,
    );
  }
}
