import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mergeArms, repos } from "~/db";
import { GitHubService } from "~/effect/github";
import { evaluatePipeline } from "~/merge/evaluate";
import type { MergeRiskAssessment } from "~/merge/assess";

// A stand-in for assessMergeRisk that never touches the network — evaluate.ts
// takes it injected exactly so tests can do this (AGENTS.md: tests are
// hermetic). Defaults to "low" so tests that don't care about risk still merge.
function fakeAssess(result: MergeRiskAssessment = { level: "low", reason: "docs-only change" }) {
  return async () => result;
}

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
  const comments: string[] = [];
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
        title: "A test PR",
        body: "Test body.",
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
    getDiff: () => Effect.succeed("diff --git a/x b/x\n+ one line\n"),
    createIssueComment: (_o: unknown, _r: unknown, _repo: unknown, _pr: unknown, body: string) =>
      Effect.sync(() => {
        comments.push(body);
      }),
    mergePull: () =>
      Effect.sync(() => {
        merged = true;
        return { ok: true as const, sha: "merge-sha" };
      }),
  } as unknown as GitHubService);
  return { gh, wasMerged: () => merged, comments };
}

test("an APPROVED review on a different SHA than the armed head does not count", async () => {
  const full = "acme/pinned-approval";
  armedRepo(full, 1, "new-sha");
  const { gh, wasMerged } = fakeLayer({ headSha: "new-sha", reviewSha: "old-sha" });

  await Effect.runPromise(evaluatePipeline(full, 1, fakeAssess()).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(false);
});

test("an APPROVED review on the armed head SHA does count", async () => {
  const full = "acme/matching-approval";
  armedRepo(full, 2, "sha-x");
  const { gh, wasMerged } = fakeLayer({ headSha: "sha-x", reviewSha: "sha-x" });

  await Effect.runPromise(evaluatePipeline(full, 2, fakeAssess()).pipe(Effect.provide(gh)));

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

  await Effect.runPromise(evaluatePipeline(full, 3, fakeAssess()).pipe(Effect.provide(gh)));

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

  await Effect.runPromise(evaluatePipeline(full, 4, fakeAssess()).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(true);
});

// The risk gate: everything else is green, but a "critical" verdict must hold
// the PR for a human rather than merge it — one comment, then a SHA-scoped
// disarm, never a GitHub merge call.
test("a critical risk verdict holds — comments and disarms, never merges", async () => {
  const full = "acme/critical-risk";
  armedRepo(full, 5, "sha-crit");
  const { gh, wasMerged, comments } = fakeLayer({ headSha: "sha-crit", reviewSha: "sha-crit" });

  await Effect.runPromise(
    evaluatePipeline(
      full,
      5,
      fakeAssess({ level: "critical", reason: "touches authentication middleware" }),
    ).pipe(Effect.provide(gh)),
  );

  expect(wasMerged()).toBe(false);
  expect(comments).toHaveLength(1);
  expect(comments[0]).toContain("Ready to merge, but holding for you");
  expect(comments[0]).toContain("touches authentication middleware");
  expect(mergeArms.get.get({ $repo: full, $pr: 5 })).toBeNull();
});

// A low verdict merges as before.
test("a low risk verdict merges", async () => {
  const full = "acme/low-risk";
  armedRepo(full, 6, "sha-low");
  const { gh, wasMerged } = fakeLayer({ headSha: "sha-low", reviewSha: "sha-low" });

  await Effect.runPromise(
    evaluatePipeline(full, 6, fakeAssess({ level: "low", reason: "docs-only" })).pipe(
      Effect.provide(gh),
    ),
  );

  expect(wasMerged()).toBe(true);
});

// assessMergeRisk itself already catches its own errors and returns
// "critical" (see merge/assess.ts) — but evaluate.ts must fail closed even if
// an injected assess implementation throws instead of returning cleanly.
test("assess throwing holds for a human rather than merging", async () => {
  const full = "acme/assess-throws";
  armedRepo(full, 7, "sha-throw");
  const { gh, wasMerged, comments } = fakeLayer({ headSha: "sha-throw", reviewSha: "sha-throw" });
  const throwingAssess = async (): Promise<never> => {
    throw new Error("upstream exploded");
  };

  await Effect.runPromise(evaluatePipeline(full, 7, throwingAssess).pipe(Effect.provide(gh)));

  expect(wasMerged()).toBe(false);
  expect(comments).toHaveLength(1);
  expect(comments[0]).toContain("Ready to merge, but holding for you");
});
