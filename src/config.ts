import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readKey(): string | undefined {
  const path = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (path) return readFileSync(path, "utf8").trim();
  return process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
}

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
mkdirSync(dataDir, { recursive: true });

// Validated, not just coerced. A bare Number() on a duration fails silently and
// in the worst possible direction: REVIEW_IDLE_TIMEOUT_MS=oops yields NaN, every
// `elapsed > NaN` comparison is false, and the watchdog that is supposed to kill
// wedged reviews simply never fires — while the config still looks configured.
// The empty string is just as bad: `??` only catches null/undefined, so
// REVIEW_IDLE_TIMEOUT_MS= becomes Number("") === 0 and every review is killed
// instantly. Anything non-finite or non-positive falls back to the default.
export function durationMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

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
    // The config dir shipped with the app (agent + custom tools). Points at the
    // in-image opencode-config in prod (Dockerfile sets OPENCODE_CONFIG_DIR), or
    // the checked-in dir in dev. fouine reads this as a *source* only — see below.
    shippedConfigDir: resolve(process.env.OPENCODE_CONFIG_DIR ?? "./opencode-config"),
    // A fouine-owned config dir on the data volume that opencode is actually
    // pointed at (boot re-exports OPENCODE_CONFIG_DIR to here). It symlinks the
    // shipped agent/tools across and adds a persistent skills/ dir fouine
    // materialises installed skills into — so global skills survive restarts
    // without mutating the read-only shipped dir. See src/skills.
    runtimeDir: resolve(`${dataDir}/opencode`),
    skillsDir: resolve(`${dataDir}/opencode/skills`),
  },
  review: {
    defaultModel: process.env.OPENCODE_MODEL ?? "opencode-go/deepseek-v4-flash",
    // The real "wedged, kill it" rule: no opencode event for the review's
    // session in this long. Elapsed time never told us whether a review was
    // slow or stuck (see the long comment in src/review/opencode.ts) — silence
    // does. Generous on purpose: a model can reason, or run one quiet command,
    // for minutes without emitting anything, and killing that is worse than
    // waiting.
    idleTimeoutMs: durationMs(process.env.REVIEW_IDLE_TIMEOUT_MS, 5 * 60 * 1000),
    // Absolute backstop, now that idleTimeoutMs does the real work. Hitting it
    // means something is looping while still emitting events — which is exactly
    // the known failure mode: a command times out, opencode tells the model
    // "retry with a larger timeout", and the model escalates. Every retry emits
    // events, so the idle rule above can NOT see it; this ceiling is its only
    // killer. That's why it's 45 min and not the hours you'd pick for a pure
    // "can't ever be legitimate" bound — until the bash-timeout clamp in
    // opencode-config lands, this number IS the escalation-loop cutoff. Raise it
    // only once that clamp is deployed and you've watched real durations.
    timeoutMs: durationMs(process.env.REVIEW_TIMEOUT_MS, 45 * 60 * 1000),
    // Bounded like everything else that spawns a subprocess: a stalled registry
    // must not hang a review. Best-effort — a timeout here logs and continues.
    installTimeoutMs: durationMs(process.env.REVIEW_INSTALL_TIMEOUT_MS, 5 * 60 * 1000),
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
