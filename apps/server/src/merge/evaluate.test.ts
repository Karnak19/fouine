import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mergeArms, repos } from "~/db";
import { GitHubService } from "~/effect/github";
import { evaluatePipeline } from "~/merge/evaluate";

function armedRepo(full: string, pr: number, sha: string) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: full,
    $prompt: null,
    $model: null,
    $enabled: 1,
    $deny_test_commands: null,
    $auto_merge: 1,
    $merge_method: null,
  });
  mergeArms.arm.run({ $repo: full, $pr: pr, $sha: sha, $by: "alice" });
}

// A minimal fake GitHubService: a green, non-draft, mergeable PR at `headSha`
// with fouine's review recorded on `reviewSha`, and nothing else in the way.
// Tracks whether mergePull was ever called.
function fakeLayer(opts: { headSha: string; reviewSha: string }) {
  let merged = false;
  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    getPull: () =>
      Effect.succeed({
        headSha: opts.headSha,
        baseRef: "main",
        draft: false,
        mergeable: true,
        merged: false,
      }),
    listReviews: () =>
      Effect.succeed([
        {
          user: "fouine[bot]",
          state: "APPROVED",
          submitted_at: "2026-01-01T00:00:00Z",
          html_url: "https://github.example/pr/1#review-1",
          body: "Looks good.",
          commit_id: opts.reviewSha,
        },
      ]),
    headChecks: () => Effect.succeed({ checks: [], statuses: [] }),
    branchProtectionRequiredChecks: () => Effect.succeed(null),
    botLogin: () => Effect.succeed("fouine[bot]"),
    createIssueComment: () => Effect.void,
    mergePull: () =>
      Effect.sync(() => {
        merged = true;
        return { ok: true as const, sha: "merge-sha" };
      }),
  } as unknown as GitHubService);
  return { gh, wasMerged: () => merged };
}

test("an APPROVED review on a different SHA than the armed head does not count", async () => {
  const full = "acme/pinned-approval";
  armedRepo(full, 1, "new-sha");
  const { gh, wasMerged } = fakeLayer({ headSha: "new-sha", reviewSha: "old-sha" });

  await Effect.runPromise(evaluatePipeline(full, 1).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(false);
});

test("an APPROVED review on the armed head SHA does count", async () => {
  const full = "acme/matching-approval";
  armedRepo(full, 2, "sha-x");
  const { gh, wasMerged } = fakeLayer({ headSha: "sha-x", reviewSha: "sha-x" });

  await Effect.runPromise(evaluatePipeline(full, 2).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(true);
});
