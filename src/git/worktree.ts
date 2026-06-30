import { $ } from "bun";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "~/config";

async function git(args: string[], cwd?: string): Promise<string> {
  const proc = await $`git ${args}`
    .cwd(cwd ?? config.dataDir)
    .quiet()
    .nothrow();
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(`git ${args.join(" ")} failed (${proc.exitCode}): ${stderr || "(no stderr)"}`);
  }
  return proc.stdout.toString().trim();
}

export function barePath(fullName: string): string {
  return `${config.reposDir}/${fullName}.git`;
}

export async function ensureBare(fullName: string, cloneUrl: string): Promise<string> {
  const bare = barePath(fullName);
  if (existsSync(bare)) {
    // ponytail: installation tokens expire (~1h), so refresh the stored remote
    // URL with the fresh token before fetching. Upgrade to http.extraHeader if
    // token-in-config becomes a concern.
    await git(["remote", "set-url", "origin", cloneUrl], bare);
    await git(["fetch", "origin", "--prune", "--quiet"], bare);
    return bare;
  }
  await Bun.write(Bun.pathToFileURL(dirname(bare)).href, "").catch(() => {});
  await $`mkdir -p ${dirname(bare)}`.quiet();
  await git(["clone", "--bare", "--quiet", cloneUrl, bare]);
  return bare;
}

export async function addWorktree(
  fullName: string,
  sha: string,
  targetPath: string,
): Promise<void> {
  const bare = barePath(fullName);
  await $`mkdir -p ${dirname(targetPath)}`.quiet();
  await git(["worktree", "add", "--force", "--detach", targetPath, sha], bare);
}

export async function removeWorktree(fullName: string, targetPath: string): Promise<void> {
  const bare = barePath(fullName);
  try {
    await git(["worktree", "remove", "--force", targetPath], bare);
  } catch {
    rmSync(targetPath, { recursive: true, force: true });
  }
  await git(["worktree", "prune", "--quiet"], bare).catch(() => {});
}

export async function fetchRef(fullName: string, ref: string): Promise<string> {
  const bare = barePath(fullName);
  await git(["fetch", "origin", `${ref}:ref`, "--quiet", "--force"], bare).catch(() =>
    git(["fetch", "origin", `${ref}`, "--quiet", "--force"], bare),
  );
  return git(["rev-parse", "FETCH_HEAD"], bare);
}
