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
    $merge_method: null, $refine_enabled: null, $refine_prompt: null, $implement_enabled: null, $implement_label: null, $implement_prompt: null, $refine_model: null, $implement_model: null, $auto_ready: null
  });
  mergeArms.arm.run({ $repo: full, $pr: pr, $sha: sha, $by: "alice" });
}

// A minimal fake GitHubService: a green, non-draft, mergeable PR at `headSha`
// with fouine's review recorded on `reviewSha`, and nothing else in the way.
// Tracks whether mergePull was ever called.
function fakeLayer(opts: {
  headSha: string;
  reviewSha: string;
  // PR author login and extra (non-fouine) reviews, for the bot-authored guard.
  author?: string;
  extraReviews?: { user: string; state: string }[];
}) {
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
        author: opts.author ?? "alice",
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
        ...(opts.extraReviews ?? []).map((r) => ({
          ...r,
          submitted_at: "2026-01-02T00:00:00Z",
          html_url: "https://github.example/pr/1#review-2",
          body: "",
          commit_id: opts.reviewSha,
        })),
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

// The bot-authored guard must not be satisfied by ANOTHER bot's approval (an
// auto-approve workflow, a second review bot) — only a human counts.
test("a bot-authored PR approved only by another bot does not merge", async () => {
  const full = "acme/bot-approves-bot";
  armedRepo(full, 3, "sha-b");
  const { gh, wasMerged } = fakeLayer({
    headSha: "sha-b",
    reviewSha: "sha-b",
    author: "fouine[bot]",
    extraReviews: [{ user: "github-actions[bot]", state: "APPROVED" }],
  });

  await Effect.runPromise(evaluatePipeline(full, 3).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(false);
});

test("a bot-authored PR approved by a human does merge", async () => {
  const full = "acme/human-approves-bot";
  armedRepo(full, 4, "sha-h");
  const { gh, wasMerged } = fakeLayer({
    headSha: "sha-h",
    reviewSha: "sha-h",
    author: "fouine[bot]",
    extraReviews: [{ user: "alice", state: "APPROVED" }],
  });

  await Effect.runPromise(evaluatePipeline(full, 4).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(true);
});
