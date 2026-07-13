import { rmSync, mkdirSync, cpSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { config } from "~/config";
import { skills as skillsDb, type SkillRow } from "~/db";
import { log } from "~/server/log";
import type { SkillFile } from "~/skills/install";

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

  // Self-hosted, single-operator: whoever installs a skill owns the box, so
  // there's no third party to gate against — allow the skill tool outright.
  writeFileSync(
    join(runtimeDir, "opencode.json"),
    JSON.stringify({ permission: { skill: { "*": "allow" } } }, null, 2),
  );
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
