import { skills as skillsDb, type SkillMetaRow } from "~/db";
import { fetchSkill } from "~/skills/install";
import { reconcileSkills } from "~/skills/materialize";

export { seedOpencodeConfig, reconcileSkills } from "~/skills/materialize";
export { parseSkillUrl } from "~/skills/source";

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
  const row = skillsDb.getMeta.get({ $name: s.name });
  if (!row) throw new Error("skill vanished after insert"); // unreachable
  return row;
}

export function setSkillEnabled(name: string, enabled: boolean): SkillMetaRow | undefined {
  const existing = skillsDb.getMeta.get({ $name: name });
  if (!existing) return undefined;
  skillsDb.setEnabled.run({ $name: name, $enabled: enabled ? 1 : 0 });
  reconcileSkills();
  return skillsDb.getMeta.get({ $name: name }) ?? undefined;
}

export function removeSkill(name: string): void {
  skillsDb.remove.run({ $name: name });
  reconcileSkills();
}

export function listSkills(): SkillMetaRow[] {
  return skillsDb.list.all();
}
