import { rmSync, mkdirSync, cpSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { config } from "~/config";
import { skills as skillsDb, type SkillRow } from "~/db";
import { log } from "~/server/log";
import type { SkillFile } from "~/skills/install";
import { hasCommandcodeKey } from "~/settings";
import {
  COMMANDCODE_BASE_URL,
  COMMANDCODE_PLUGIN,
  COMMANDCODE_PROVIDER,
  COMMANDCODE_PROVIDER_NAME,
} from "~/review/commandcode";

// The opencode.json fouine writes into the runtime config dir. Pure so the
// interesting part — which keys appear — is testable without touching the
// filesystem.
//
// Relies on opencode v2 reading opencode.json from OPENCODE_CONFIG_DIR
// (verified against 2.0.11 via `opencode debug config`) and normalizing the
// native `update` and `skills` fields.
export function buildOpencodeConfig(skillsDir?: string): Record<string, unknown> {
  const bash: Record<string, string> = { "*": "allow" };
  return {
    $schema: "https://opencode.ai/config.json",
    // The Dockerfile pins the CLI to the version @opencode/client speaks
    // (see its ponytail comment); a binary that upgrades itself inside a
    // long-running container silently breaks that pin and can drift the
    // server protocol away from what the SDK speaks. If a future CLI stops
    // recognising the key it will just ignore it — no behaviour change.
    autoupdate: false,
    permission: {
      // Self-hosted, single-operator: whoever installs a skill owns the box, so
      // there's no third party to gate against — allow the skill tool outright.
      skill: { "*": "allow" },
      bash,
    },
    // Skills are materialised under skillsDir by reconcileSkills. Declared
    // explicitly rather than relying on v2 auto-discovering `<config
    // dir>/skills/` — the documented discovery paths are project `.opencode/`
    // dirs, and an explicit path removes the question entirely.
    ...(skillsDir ? { skills: [skillsDir] } : {}),
    // Command Code is not in models.dev, so opencode only knows it through this
    // declaration: an OpenAI-compatible gateway whose model list the
    // @brainervirus/opencode-commandcode plugin fills in from its bundled
    // catalog (its `config` hook only does so when the block has no `models`
    // key — so none is written here). Both the plugin and the provider block
    // are gated on a Command Code key being configured: listing the plugin
    // unconditionally would make every fresh deployment fetch it from npm on
    // its first review for nothing, and the block is useless without the key.
    // The gate is cheap to honour because PUT /api/settings re-writes this file
    // (writeOpencodeConfig) whenever the key field is saved, so the next spawn
    // sees the change — same install-once caching as PostHog below. The key
    // itself is NOT written here: setProviderApiKey (review/opencode.ts) sets
    // it through auth.set per spawn, so the on-disk config never carries a
    // secret; `env` only mirrors the plugin's own declaration.
    ...(hasCommandcodeKey()
      ? {
          provider: {
            [COMMANDCODE_PROVIDER]: {
              npm: "@ai-sdk/openai-compatible",
              name: COMMANDCODE_PROVIDER_NAME,
              env: ["COMMANDCODE_API_KEY"],
              options: { baseURL: COMMANDCODE_BASE_URL },
            },
          },
        }
      : {}),
    // PostHog AI observability ($ai_generation per LLM roundtrip, $ai_span per
    // tool call with real latency, $ai_trace per prompt). Declared only when an
    // API key is present; the install is cached per package spec under
    // ~/.cache/opencode/packages/, so when enabled it is a one-time cost.
    //
    // Known gap: @posthog/opencode implements the V1 plugin API, and V1 plugin
    // implementations do not run in v2 — so until upstream ships a v2 build
    // this entry is inert (opencode logs a load warning). Kept so operators
    // who set POSTHOG_API_KEY get observability back the moment upstream
    // catches up, with no fouine change.
    ...pluginList(),
  };
}

// The `plugin` key is omitted entirely when no plugin applies: opencode treats
// an absent key and an empty array the same, and the old tests pin "absent".
function pluginList(): { plugin?: string[] } {
  const plugins: string[] = [];
  if (hasCommandcodeKey()) plugins.push(COMMANDCODE_PLUGIN);
  if (process.env.POSTHOG_API_KEY) plugins.push("@posthog/opencode");
  return plugins.length ? { plugin: plugins } : {};
}

// (Re)write the runtime dir's opencode.json from current settings. Called by
// seedOpencodeConfig on boot and by PUT /api/settings when the Command Code key
// changes, since buildOpencodeConfig's output depends on it. A running review
// is unaffected: opencode reads the file once at spawn.
export function writeOpencodeConfig(): void {
  writeFileSync(
    join(config.opencode.runtimeDir, "opencode.json"),
    JSON.stringify(buildOpencodeConfig(), null, 2),
  );
}

// fouine points opencode at a config dir it fully owns on the data volume,
// rather than the read-only shipped dir. This seeds that runtime dir: copy
// every shipped entry (agent, plugins, …) across so the fouine agent + custom
// tools still load, drop an opencode.json with the v2-native keys, and expose
// a skills/ dir we materialise installed skills into. Sets OPENCODE_CONFIG_DIR
// so the one long-lived server the manager spawns (effect/opencode.ts) reads it.
// Copies, not symlinks: the v1 realpath/node_modules resolution trap is gone
// (the v2 plugin files import nothing at runtime — `import type` only), but
// copies also keep the runtime dir self-contained on the data volume.
// Idempotent: rebuilt from scratch on each call (cheap — a handful of files).
// A running server does not notice a rebuild by itself — mutation callers ask
// it to reload (see reloadOpencodeConfig in skills/index.ts).
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
    // skills/ and opencode.json are fouine-owned in the runtime dir; the v2
    // plugin files have no runtime deps, so no node_modules is needed — skip
    // one if a dev copy ever appears.
    if (
      entry === "skills" ||
      entry === "opencode.json" ||
      entry === "node_modules" ||
      entry === "package.json" ||
      entry === "package-lock.json" ||
      entry === "bun.lock"
    )
      continue;
    cpSync(resolve(shippedConfigDir, entry), join(runtimeDir, entry), { recursive: true });
  }

  const skillsDir = config.opencode.skillsDir;
  writeFileSync(
    join(runtimeDir, "opencode.json"),
    JSON.stringify(buildOpencodeConfig(skillsDir), null, 2),
  );
  mkdirSync(skillsDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = runtimeDir;
  log.info("seeded opencode config", { runtimeDir, shippedConfigDir, copied: shipped.length });
}

// Rebuild the on-disk skills dir from the DB (the source of truth) so drift —
// a backup restore, a manual edit — never survives. Writes only enabled skills;
// disabled/removed ones simply vanish from disk. Called on boot and after every
// install/toggle/remove; the mutation callers then ask the running server to
// reload (skills/index.ts), because a warm server caches the config it read at
// spawn and would otherwise keep serving the old skills.
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
