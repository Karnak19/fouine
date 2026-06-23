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
  review: {
    defaultModel: process.env.OPENCODE_MODEL ?? "anthropic/claude-sonnet-4-5",
    timeoutMs: Number(process.env.REVIEW_TIMEOUT_MS ?? 10 * 60 * 1000),
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
