// Parses the URL a user pastes in the dashboard into a GitHub source. Two forms:
//   - skills.sh registry page:  https://www.skills.sh/{owner}/{repo}/{skill}
//   - a GitHub URL:             https://github.com/{owner}/{repo}
//                               https://github.com/{owner}/{repo}/tree/{ref}/{path-to-skill-dir}
// skills.sh is just an index over GitHub, so both resolve to a repo + optional
// skill name / path we then locate the SKILL.md under (see install.ts).

export interface SkillSource {
  owner: string;
  repo: string;
  // Skill name hint (skills.sh URL, or last path segment of a github tree URL).
  skill?: string;
  // Explicit dir path within the repo (from a github tree/blob URL).
  path?: string;
  // Branch/tag/sha from a github URL; resolved to the default branch when absent.
  ref?: string;
}

export function parseSkillUrl(raw: string): SkillSource {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "skills.sh") {
    const [owner, repo, skill] = parts;
    if (!owner || !repo) {
      throw new Error("skills.sh URL must look like https://skills.sh/{owner}/{repo}/{skill}");
    }
    return { owner, repo: stripGit(repo), skill };
  }

  if (host === "github.com") {
    const [owner, repo, kind, ref, ...rest] = parts;
    if (!owner || !repo) throw new Error("GitHub URL must include /{owner}/{repo}");
    if ((kind === "tree" || kind === "blob") && ref) {
      const path = rest.join("/").replace(/\/SKILL\.md$/i, "");
      return {
        owner,
        repo: stripGit(repo),
        ref,
        path: path || undefined,
        skill: path ? path.split("/").pop() : undefined,
      };
    }
    return { owner, repo: stripGit(repo) };
  }

  throw new Error(`Unsupported host "${host}" — paste a skills.sh or github.com URL.`);
}

function stripGit(repo: string): string {
  return repo.replace(/\.git$/, "");
}
