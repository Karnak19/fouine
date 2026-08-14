import { test, expect, beforeAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "~/config";
import { barePath, patchId } from "~/git/worktree";

// Real git, not mocks. The whole feature rests on `git patch-id --stable` being
// stable across a rebase and unstable across a content change, and on the base
// being the one *this* review fetched. None of that is observable through a
// stubbed GitService.

const FULL = "acme/patchid";
let origin: string;
// Two base branches, one shared head commit — the shape that used to collide.
let headSha: string;

const git = async (args: string[], cwd: string) => {
  const p = await $`git ${args}`.cwd(cwd).quiet().nothrow();
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
};

beforeAll(async () => {
  origin = mkdtempSync(join(tmpdir(), "fouine-origin-"));
  await git(["init", "-q", "--initial-branch=main", "."], origin);
  await git(["config", "user.email", "t@t"], origin);
  await git(["config", "user.name", "t"], origin);
  await Bun.write(join(origin, "a.txt"), "a\n");
  await git(["add", "-A"], origin);
  await git(["commit", "-qm", "base"], origin);

  // A second base branch that diverges from main by one file.
  await git(["checkout", "-qb", "release"], origin);
  await Bun.write(join(origin, "release-only.txt"), "r\n");
  await git(["add", "-A"], origin);
  await git(["commit", "-qm", "release diverges"], origin);

  // The head forks from `release`, NOT from main. This matters: a three-dot diff
  // is taken from the merge-base, so if both candidate bases shared a merge-base
  // with the head the two diffs would be identical *by design* and the collision
  // would be unobservable. Forking from release makes merge-base(main, feature)
  // the root commit and merge-base(release, feature) the release tip, so the two
  // diffs genuinely differ — main...feature carries release-only.txt, and
  // release...feature does not.
  await git(["checkout", "-qb", "feature"], origin);
  await Bun.write(join(origin, "feature.txt"), "f\n");
  await git(["add", "-A"], origin);
  await git(["commit", "-qm", "feature work"], origin);
  headSha = await git(["rev-parse", "HEAD"], origin);

  // The bare mirror fouine works against, where patchId() looks for it.
  const bare = barePath(FULL);
  await $`mkdir -p ${config.reposDir}`.quiet();
  await git(["clone", "--bare", "--quiet", origin, bare], config.reposDir);
  await git(["remote", "set-url", "origin", origin], bare);
  // Objects for the head commit must be present, as they are after fetchRef.
  await git(["fetch", "origin", "--quiet", "--force"], bare);
});

// The bug the review caught: the temp base ref was keyed by headSha alone, so
// two reviews of the same head against different bases shared one mutable ref.
// The loser hashed its head against the other's base — no error, wrong id, and
// a genuinely changed diff can then match a stale baseline and be skipped.
// Keying by review id makes the collision impossible; resolving the ref to a
// SHA before diffing makes the hash independent of the ref even so.
test("same head, different base refs → different patch-ids", async () => {
  const againstMain = await patchId(FULL, "main", headSha, 1);
  const againstRelease = await patchId(FULL, "release", headSha, 2);

  expect(againstMain).toBeTruthy();
  expect(againstRelease).toBeTruthy();
  // main...feature adds release-only.txt and feature.txt; release...feature adds
  // only feature.txt. Genuinely different diffs, so genuinely different ids.
  expect(againstMain).not.toBe(againstRelease);
});

// Interleaved the way two concurrent reviews actually run: both fetch before
// either diffs. With a shared ref name the second fetch would clobber the first
// review's base between its fetch and its hash.
test("concurrent reviews of the same head do not corrupt each other", async () => {
  const [a, b] = await Promise.all([
    patchId(FULL, "main", headSha, 11),
    patchId(FULL, "release", headSha, 12),
  ]);
  // Each must equal what it computes alone — the serial run is the oracle.
  expect(a).toBe(await patchId(FULL, "main", headSha, 13));
  expect(b).toBe(await patchId(FULL, "release", headSha, 14));
  expect(a).not.toBe(b);
});

// The primitive itself: content identity, not commit identity.
test("patch-id survives a rebase and changes on a real edit", async () => {
  const bare = barePath(FULL);
  const refetch = async () => {
    await git(["fetch", "origin", "--quiet", "--force"], bare);
    await git(
      ["fetch", "origin", "refs/heads/feature:refs/heads/feature", "--quiet", "--force"],
      bare,
    );
  };
  // `feature` sits on `release`, so release is its real base — the same base the
  // whole test uses before and after, which is what makes the comparison mean
  // "the content did not change" rather than "the base did not change".
  const before = await patchId(FULL, "release", headSha, 21);

  // release advances with a commit feature does not touch, then feature is
  // rebased onto it — new commits, identical content.
  await git(["checkout", "-q", "release"], origin);
  await Bun.write(join(origin, "unrelated.txt"), "u\n");
  await git(["add", "-A"], origin);
  await git(["commit", "-qm", "release advances"], origin);
  await git(["checkout", "-q", "feature"], origin);
  await git(["rebase", "-q", "release"], origin);
  const rebasedSha = await git(["rev-parse", "HEAD"], origin);
  expect(rebasedSha).not.toBe(headSha);
  await refetch();

  expect(await patchId(FULL, "release", rebasedSha, 22)).toBe(before!);

  // A real content change must not.
  await Bun.write(join(origin, "feature.txt"), "f changed\n");
  await git(["commit", "-qam", "real change"], origin);
  const changedSha = await git(["rev-parse", "HEAD"], origin);
  await refetch();

  expect(await patchId(FULL, "release", changedSha, 23)).not.toBe(before!);
});

// Absence must mean "review", never "skip".
test("an unresolvable base degrades to undefined, not a wrong id", async () => {
  expect(await patchId(FULL, "no-such-branch", headSha, 31)).toBeUndefined();
});

// The temp ref is cleaned up, so a long-lived bare repo doesn't accumulate one
// ref per review ever run against it.
test("the temporary base ref is deleted afterwards", async () => {
  await patchId(FULL, "main", headSha, 41);
  const refs = await git(["for-each-ref", "--format=%(refname)", "refs/fouine/"], barePath(FULL));
  expect(refs).toBe("");
});
