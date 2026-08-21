import { rmSync, mkdirSync, cpSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { config } from "~/config";
import { skills as skillsDb, type SkillRow } from "~/db";
import { log } from "~/server/log";
import type { SkillFile } from "~/skills/install";

// Commands the reviewer agent must never run itself. fouine installs the repo's
// dependencies for it (bounded, before the session starts), so an agent-initiated
// install is always either a duplicate or an unbounded network wait — and it was
// a reliable way to burn the whole review budget.
//
// Pattern semantics (opencode's own matcher, NOT real globs): `*` expands to `.*`
// and crosses `/`, and the WHOLE string must match. opencode special-cases a
// trailing " *" so that "yarn *" also matches a bare "yarn" — but that special
// case is the one rule here we did not verify ourselves, so every command is
// listed in both bare and trailing-`*` form. Redundant if the special case works,
// correct either way.
//
// Matching is per parsed command node, so `cd /tmp && npm install` is checked as
// two commands and still denied.
//
// ponytail: textual/AST matching, not a sandbox. `sh -c 'npm install'`, `eval`, a
// shell script, or an alias does not decompose into the inner command and slips
// straight through. This stops the model doing the obvious thing, which is the
// actual failure mode; it is not a containment boundary. The container is.
const INSTALL_COMMANDS = [
  "bun install",
  "bun add",
  "bun i",
  "npm install",
  "npm ci",
  "npm add",
  "npm i",
  "pnpm install",
  "pnpm add",
  "pnpm i",
  "yarn",
  "yarn install",
  "yarn add",
];

// Commands the reviewer agent is denied when the deny-test-commands toggle is on
// (global setting, per-repo override). CI already ran these on the same commit,
// and the review worktree usually has no env vars — so a local run mostly
// produces failures that belong to the environment, not the PR, and the agent
// can report them as findings. Same pattern semantics as INSTALL_COMMANDS above:
// specific patterns only, both bare and trailing-`*` form.
const TEST_COMMANDS = [
  "bun test",
  "bun run test",
  "bun run build",
  "bun run lint",
  "bun run typecheck",
  "bunx vitest",
  "bunx oxlint",
  "bunx tsc",
  "vitest",
  "oxlint",
  "eslint",
  "jest",
  "tsc",
  "npx vitest",
  "npx eslint",
  "npx jest",
  "npx tsc",
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm lint",
  "pnpm typecheck",
  "yarn test",
  "yarn build",
  "yarn lint",
  "yarn typecheck",
];

// The per-spawn config passed to createOpencode, layered on top of the config
// dir's opencode.json. Empirically (opencode 1.18.21) opencode DEEP-MERGES
// permission.bash key-by-key and appends the per-spawn keys AFTER the dir's,
// insertion order preserved — and last matching rule wins, so these denies land
// after the dir's blanket `"*": "allow"` and take effect.
//
// Consequence: this map must carry ONLY deny keys. Re-sending `"*": "allow"`
// here would be deduped in place at position 0, not moved to the end, so it
// would buy nothing — and a `"*"` DENY must never appear (opencode drops bash
// from the model's tool list entirely, leaving the reviewer unable to run
// anything). Denylist of specific patterns, always.
export function reviewOpencodeConfig(denyTestCommands: boolean): Record<string, unknown> {
  if (!denyTestCommands) return {};
  const bash: Record<string, string> = {};
  for (const cmd of TEST_COMMANDS) {
    bash[cmd] = "deny";
    bash[`${cmd} *`] = "deny";
  }
  return { permission: { bash } };
}

// The opencode.json fouine writes into the runtime config dir. Pure so the
// interesting part — which keys appear, and the POSTHOG_API_KEY branch — is
// testable without touching the filesystem.
//
// Relies on opencode reading opencode.json from OPENCODE_CONFIG_DIR, and on that
// dir being LAST in opencode's config-dir list so these keys win over global and
// project config. Verified empirically against opencode 1.18.18 (`opencode debug
// config` and the server's /config endpoint both echo these keys back, including
// under the SDK's OPENCODE_CONFIG_CONTENT={} spawn env, and with insertion order
// preserved so the deny-after-allow ordering below survives).
//
// This is NOT a documented guarantee — opencode's docs only promise
// agents/commands/modes/plugins from that dir, so re-run that check when bumping
// the pinned opencode version in the Dockerfile.
export function buildOpencodeConfig(): Record<string, unknown> {
  const bash: Record<string, string> = { "*": "allow" };
  // Last matching rule wins, so the blanket allow must be written first and the
  // denies after it. Never use a "*" DENY here: a "*"-pattern deny makes opencode
  // drop the tool from the model's tool list entirely, which would leave the
  // reviewer unable to run anything at all.
  for (const cmd of INSTALL_COMMANDS) {
    bash[cmd] = "deny";
    bash[`${cmd} *`] = "deny";
  }

  return {
    $schema: "https://opencode.ai/config.json",
    permission: {
      // Self-hosted, single-operator: whoever installs a skill owns the box, so
      // there's no third party to gate against — allow the skill tool outright.
      skill: { "*": "allow" },
      bash,
    },
    // PostHog AI observability ($ai_generation per LLM roundtrip, $ai_span per
    // tool call with real latency, $ai_trace per prompt). Declared only when an
    // API key is present, for two reasons: the plugin is a no-op without one
    // anyway (it returns zero hooks), and listing it unconditionally would make
    // every fresh deployment fetch the package from npm on its first review for
    // no benefit. Self-hosters with no PostHog therefore get byte-identical
    // behaviour to before: no package fetch, no network, no log output.
    //
    // The install is cached per package spec under ~/.cache/opencode/packages/,
    // so even when enabled it is a one-time cost, not per-spawn. It also happens
    // after the server is already listening, so it does not block the spawn.
    //
    // Blind spot worth knowing before trusting a PostHog dashboard: spans are
    // emitted only when a tool reaches completed/error, and $ai_trace only on
    // session.idle. A tool call that HANGS produces neither — PostHog shows the
    // generations up to the hang and then silence, with no error event. Absence
    // of a trace means "wedged", not "never ran".
    ...(process.env.POSTHOG_API_KEY ? { plugin: ["@posthog/opencode"] } : {}),
  };
}

// fouine points opencode at a config dir it fully owns on the data volume,
// rather than the read-only shipped dir. This seeds that runtime dir: copy
// every shipped entry (agent, tools, …) across so the fouine agent + custom
// tools still load, drop an opencode.json that allows the skill tool, and expose
// a skills/ dir we materialise installed skills into. Re-exports
// OPENCODE_CONFIG_DIR so every opencode subprocess spawned after boot sees it.
// Copies, not symlinks: opencode installs tool deps (@opencode-ai/plugin) into
// a node_modules under the config dir, and Bun resolves imports from a tool
// file's REALPATH — a symlinked tools/ resolves back inside the shipped dir,
// misses that node_modules, and every session.prompt dies with UnknownError.
// Idempotent: rebuilt from scratch on each call (cheap — a handful of files).
export function seedOpencodeConfig(): void {
  const { shippedConfigDir, runtimeDir } = config.opencode;
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });

  let shipped: string[] = [];
  try {
    shipped = readdirSync(shippedConfigDir);
  } catch {
    // No shipped config dir (unusual, but the agent may be resolved elsewhere).
  }
  for (const entry of shipped) {
    // skills/ and opencode.json are fouine-owned in the runtime dir; opencode's
    // own dep install (node_modules, package*.json) regenerates in the runtime
    // dir on first prompt, so don't drag a stale dev copy across.
    // NOTE: plugin/ is NOT skipped — it must be copied, since opencode discovers
    // local plugins by globbing {plugin,plugins}/*.{ts,js} inside each config
    // dir, and the dir it globs is this runtime dir, not the shipped one.
    if (
      entry === "skills" ||
      entry === "opencode.json" ||
      entry === "node_modules" ||
      entry === "package.json" ||
      entry === "package-lock.json"
    )
      continue;
    cpSync(resolve(shippedConfigDir, entry), join(runtimeDir, entry), { recursive: true });
  }

  writeFileSync(join(runtimeDir, "opencode.json"), JSON.stringify(buildOpencodeConfig(), null, 2));
  mkdirSync(config.opencode.skillsDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = runtimeDir;
  log.info("seeded opencode config", { runtimeDir, shippedConfigDir, copied: shipped.length });
}

// Rebuild the on-disk skills dir from the DB (the source of truth) so drift —
// a backup restore, a manual edit — never survives. Writes only enabled skills;
// disabled/removed ones simply vanish from disk. Called on boot and after every
// install/toggle/remove, so the next review's opencode picks up the change.
export function reconcileSkills(): void {
  const dir = config.opencode.skillsDir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const rows = skillsDb.enabled.all();
  for (const row of rows) writeSkill(dir, row);
  log.info("reconciled skills", { count: rows.length });
}

function writeSkill(dir: string, row: SkillRow): void {
  const files = JSON.parse(row.files) as SkillFile[];
  const skillDir = join(dir, row.name);
  for (const f of files) {
    const dest = resolve(skillDir, f.path);
    // Guard against path traversal in file paths sourced from GitHub.
    if (dest !== skillDir && !dest.startsWith(skillDir + "/")) {
      log.warn("skipping skill file outside its dir", { skill: row.name, path: f.path });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(f.contentBase64, "base64"));
  }
}
