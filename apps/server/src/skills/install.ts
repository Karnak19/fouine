import { parseSkillUrl, type SkillSource } from "~/skills/source";

// Fetches a skill from a public GitHub repo via the unauthenticated contents
// API — no token needed (skills come from arbitrary public repos the App isn't
// installed on) and no `npx skills` runtime dependency. Bounded in file count
// and total size so a pathological repo can't blow up a review's context or the
// DB row.

const GH = "https://api.github.com";
const UA = "fouine";
const MAX_FILES = 25;
const MAX_BYTES = 1_000_000; // 1 MB across all files in the skill dir

export interface SkillFile {
  path: string; // relative to the skill dir
  contentBase64: string;
}

export interface FetchedSkill {
  name: string;
  sourceUrl: string;
  owner: string;
  repo: string;
  path: string; // skill dir path within the repo
  ref: string; // pinned commit SHA
  description: string | null;
  files: SkillFile[];
}

interface GhContent {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${GH}${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": UA },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub ${path} → ${res.status} ${detail}`.slice(0, 300));
  }
  return res.json() as Promise<T>;
}

async function defaultBranch(owner: string, repo: string): Promise<string> {
  const r = await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return r.default_branch;
}

// Resolve any ref (branch/tag/sha) to a concrete commit SHA so the install is
// pinned — `npx skills update` becomes an explicit re-install, not silent drift.
async function resolveSha(owner: string, repo: string, ref: string): Promise<string> {
  const r = await gh<{ sha: string }>(`/repos/${owner}/${repo}/commits/${ref}`);
  return r.sha;
}

// Where the SKILL.md might live, in priority order. An explicit path (github
// tree URL) wins; otherwise probe the conventional skill locations for the name.
function candidatePaths(src: SkillSource): string[] {
  if (src.path) return [src.path];
  const paths: string[] = [];
  const s = src.skill;
  if (s) {
    paths.push(s, `skills/${s}`, `.claude/skills/${s}`, `.opencode/skills/${s}`, `.agents/skills/${s}`);
  }
  paths.push(""); // repo root, last resort
  return paths;
}

async function findSkillDir(
  owner: string,
  repo: string,
  ref: string,
  candidates: string[],
): Promise<{ dir: string; entries: GhContent[] }> {
  for (const dir of candidates) {
    const suffix = dir ? `/${dir}` : "";
    let entries: GhContent[];
    try {
      entries = await gh<GhContent[]>(`/repos/${owner}/${repo}/contents${suffix}?ref=${ref}`);
    } catch {
      continue; // path doesn't exist at this ref — try the next candidate
    }
    if (Array.isArray(entries) && entries.some((e) => e.type === "file" && e.name.toUpperCase() === "SKILL.MD")) {
      return { dir, entries };
    }
  }
  throw new Error(
    "No SKILL.md found. Point the URL at the skill directory (e.g. a github tree URL) or check the skill name.",
  );
}

async function download(
  owner: string,
  repo: string,
  ref: string,
  entries: GhContent[],
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  let bytes = 0;

  const walk = async (prefix: string, list: GhContent[]): Promise<void> => {
    for (const e of list) {
      if (files.length >= MAX_FILES) throw new Error(`Skill has more than ${MAX_FILES} files.`);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.type === "dir") {
        const sub = await gh<GhContent[]>(`/repos/${owner}/${repo}/contents/${e.path}?ref=${ref}`);
        await walk(rel, sub);
      } else if (e.type === "file" && e.download_url) {
        const res = await fetch(e.download_url, { headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        bytes += buf.length;
        if (bytes > MAX_BYTES) throw new Error("Skill exceeds the 1 MB size limit.");
        files.push({ path: rel, contentBase64: buf.toString("base64") });
      }
    }
  };

  await walk("", entries);
  return files;
}

// Minimal YAML frontmatter reader — skills only need `name` + `description`, so
// a full YAML parser would be dead weight. Handles the `---\n...\n---` block,
// including `>`/`|` block scalars (which SKILL.md descriptions commonly use).
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const field = (key: string): string | undefined => {
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (i < 0) return undefined;
    const inline = lines[i].slice(key.length + 1).trim();
    // Block scalar (`>` folded / `|` literal): gather the following indented lines.
    if (inline === ">" || inline === "|" || /^[>|][+-]?$/.test(inline)) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== "" && !/^\s/.test(lines[j])) break; // dedented → next key
        body.push(lines[j].trim());
      }
      return body.join(" ").trim() || undefined;
    }
    return inline.replace(/^["']|["']$/g, "") || undefined;
  };
  return { name: field("name"), description: field("description") };
}

export async function fetchSkill(rawUrl: string): Promise<FetchedSkill> {
  const src = parseSkillUrl(rawUrl);
  const ref = src.ref ?? (await defaultBranch(src.owner, src.repo));
  const sha = await resolveSha(src.owner, src.repo, ref);
  const { dir, entries } = await findSkillDir(src.owner, src.repo, sha, candidatePaths(src));
  const files = await download(src.owner, src.repo, sha, entries);

  const skillMd = files.find((f) => f.path.toUpperCase() === "SKILL.MD");
  if (!skillMd) throw new Error("SKILL.md missing after download.");
  const fm = parseFrontmatter(Buffer.from(skillMd.contentBase64, "base64").toString("utf8"));

  const name = (fm.name ?? src.skill ?? dir.split("/").pop() ?? src.repo).toLowerCase();
  // opencode requires: lowercase alphanumeric with single-hyphen separators.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid skill name "${name}" — expected lowercase-with-hyphens.`);
  }

  return {
    name,
    sourceUrl: rawUrl,
    owner: src.owner,
    repo: src.repo,
    path: dir,
    ref: sha,
    description: fm.description ?? null,
    files,
  };
}
