import { skills as skillsDb, type SkillMetaRow } from "~/db";
import { fetchSkill } from "~/skills/install";
import { reconcileSkills } from "~/skills/materialize";
import { log } from "~/server/log";

export { seedOpencodeConfig, writeOpencodeConfig, reconcileSkills } from "~/skills/materialize";
export { parseSkillUrl } from "~/skills/source";

// A warm opencode server reads the config dir once, at spawn, so `reconcileSkills`
// changing the skills/ tree on disk is invisible to it until we ask it to reload.
// locationReload() is a no-op when the manager has no live server (mutations
// before the first review, the common case), so it's safe to call unconditionally.
// Dynamic import keeps the skills layer from statically pulling in the effect /
// opencode client graph; fire-and-forget because the reload only has to land
// before the NEXT review's session is created, and a mutation must not fail if
// the server is mid-restart.
export function reloadOpencodeConfig(): void {
  void import("~/effect/opencode")
    .then(({ openCodeManager }) => openCodeManager.locationReload())
    .catch((err) => log.warn("opencode config reload failed", { error: String(err) }));
}

// Install (or re-install) a skill from a skills.sh / GitHub URL. Fetches +
// pins, stores it enabled, materialises it to disk, and returns the metadata
// row — so it's live on the next review without a second click.
export async function installSkill(url: string): Promise<SkillMetaRow> {
  const s = await fetchSkill(url);
  skillsDb.upsert.run({
    $name: s.name,
    $source_url: s.sourceUrl,
    $owner: s.owner,
    $repo: s.repo,
    $path: s.path,
    $ref: s.ref,
    $description: s.description,
    $files: JSON.stringify(s.files),
  });
  reconcileSkills();
  reloadOpencodeConfig();
  const row = skillsDb.getMeta.get({ $name: s.name });
  if (!row) throw new Error("skill vanished after insert"); // unreachable
  return row;
}

export function setSkillEnabled(name: string, enabled: boolean): SkillMetaRow | undefined {
  const existing = skillsDb.getMeta.get({ $name: name });
  if (!existing) return undefined;
  skillsDb.setEnabled.run({ $name: name, $enabled: enabled ? 1 : 0 });
  reconcileSkills();
  reloadOpencodeConfig();
  return skillsDb.getMeta.get({ $name: name }) ?? undefined;
}

export function removeSkill(name: string): void {
  skillsDb.remove.run({ $name: name });
  reconcileSkills();
  reloadOpencodeConfig();
}

export function listSkills(): SkillMetaRow[] {
  return skillsDb.list.all();
}
