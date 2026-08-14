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

// Reading a diff to hash it costs memory proportional to the diff. Past this
// many changed lines we decline rather than risk it — a missed saving is fine.
const MAX_DIFF_LINES = 200_000;

// Diff-content identity: `git patch-id --stable` hashes what a diff *contains*,
// deliberately independent of the commits and the base it sits on. That is
// exactly the difference between "rebased" and "changed". Three-dot (base...head,
// from the merge-base) makes it stable across both a rebase onto a new base and
// a merge of the base into the branch.
// Returns undefined whenever we cannot get a trustworthy id — the caller then
// reviews. A missed saving is fine; a wrongly-skipped review is not.
export async function patchId(
  fullName: string,
  baseRef: string,
  headSha: string,
  reviewId: number,
): Promise<string | undefined> {
  const bare = barePath(fullName);
  // The bare clone has no tracking refspec, so its refs/heads/* go stale after
  // the initial clone — fetch the base branch explicitly.
  //
  // Two levels of isolation here, both deliberate, following #23's precedent:
  // don't make a shared mutable name cleverer, stop depending on one.
  //
  // 1. The ref is keyed by review id, which is unique per run by construction.
  //    Not FETCH_HEAD (repo-global) and emphatically not the head SHA: two PRs
  //    can point at the same head commit while targeting different base
  //    branches, and those are legitimately different diffs. A SHA-keyed ref
  //    lets one review's fetch overwrite the other's base, and the loser hashes
  //    its head against the wrong base with no error anywhere. That inverts the
  //    whole feature — a genuinely changed diff silently not reviewed.
  // 2. The ref is resolved to a commit SHA immediately and everything below
  //    diffs against that SHA, never the ref. So even if a future caller
  //    reintroduces a shared name, or this run's own cleanup races another, the
  //    hash is taken against the exact commit we fetched.
  const baseLocal = `refs/fouine/base/${reviewId}`;
  try {
    await git(["fetch", "origin", `refs/heads/${baseRef}:${baseLocal}`, "--quiet", "--force"], bare);
    const baseSha = await git(["rev-parse", `${baseLocal}^{commit}`], bare);

    // Bound the work before doing it (issue trap 7).
    const shortstat = await git(["diff", "--shortstat", `${baseSha}...${headSha}`], bare);
    const changed = [...shortstat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce(
      (n, m) => n + Number(m[1]),
      0,
    );
    // ponytail: no logger in this module — an over-cap diff just degrades to
    // "run the review", which is what a caller does with undefined anyway.
    if (changed > MAX_DIFF_LINES) return undefined;

    const proc = await $`git diff --no-color ${baseSha}...${headSha} | git patch-id --stable`
      .cwd(bare)
      .quiet()
      .nothrow();
    if (proc.exitCode !== 0) return undefined;
    // Empty diff → patch-id prints nothing → undefined → review runs.
    return proc.stdout.toString().trim().split(/\s+/)[0] || undefined;
  } catch {
    return undefined;
  } finally {
    await git(["update-ref", "-d", baseLocal], bare).catch(() => {});
  }
}
