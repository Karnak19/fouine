import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { findings, nitDismissals, repos, reviews, type FindingRow } from "~/db";
import { GitHubService, type GitHubServiceShape } from "~/effect/github";
import {
  decideSkipNits,
  renderSkipNitsApproval,
  skipNitsPipeline,
  type SkipNitsInput,
  type SkipNitsReview,
} from "~/review/skip-nits";

const HEAD = "head1234567";

function finding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 1,
    review_id: 1,
    repo_full_name: "acme/app",
    pr_number: 1,
    kind: "inline",
    severity: "nit",
    event: null,
    path: "src/a.ts",
    line: 3,
    body: "Rename this.",
    github_review_id: 100,
    github_comment_id: null,
    created_at: 0,
    ...overrides,
  };
}

function review(overrides: Partial<SkipNitsReview> = {}): SkipNitsReview {
  return {
    id: 100,
    state: "COMMENTED",
    submitted_at: "2026-01-01T00:00:00Z",
    commit_id: HEAD,
    ...overrides,
  };
}

function input(overrides: Partial<SkipNitsInput> = {}): SkipNitsInput {
  return {
    commenter: "alice",
    prAuthor: "alice",
    headSha: HEAD,
    reviewRunning: false,
    fouineReviews: [review()],
    findings: [
      finding({ kind: "summary", severity: null, event: "COMMENT", path: null, line: null }),
      finding({ id: 2 }),
      finding({ id: 3, severity: "question", body: "Why here?" }),
    ],
    ...overrides,
  };
}

function reasonOf(i: SkipNitsInput): string {
  const d = decideSkipNits(i);
  return d.kind === "refuse" ? d.reason : d.kind;
}

test("approves when the latest head review has only nits and questions", () => {
  const d = decideSkipNits(input());
  expect(d.kind).toBe("approve");
  if (d.kind === "approve") {
    expect(d.review.id).toBe(100);
    expect(d.skipped.map((f) => f.id)).toEqual([2, 3]);
  }
});

test("refuses anyone but the PR author", () => {
  expect(reasonOf(input({ commenter: "mallory" }))).toBe("not-author");
  expect(reasonOf(input({ commenter: undefined }))).toBe("not-author");
  expect(reasonOf(input({ prAuthor: null }))).toBe("not-author");
});

test("refuses while a review is running", () => {
  expect(reasonOf(input({ reviewRunning: true }))).toBe("review-running");
});

test("refuses when fouine has no review on the current head", () => {
  expect(reasonOf(input({ fouineReviews: [] }))).toBe("no-review");
  // A review of an older commit doesn't count: the head moved since.
  expect(reasonOf(input({ fouineReviews: [review({ commit_id: "old" })] }))).toBe("no-review");
  // A PENDING draft isn't a posted review.
  expect(reasonOf(input({ fouineReviews: [review({ state: "PENDING" })] }))).toBe("no-review");
});

test("refuses when the latest review has a blocking finding", () => {
  const i = input();
  i.findings.push(finding({ id: 4, severity: "blocking" }));
  expect(reasonOf(i)).toBe("blocking");
});

test("CHANGES_REQUESTED counts as blocking even without stored rows", () => {
  expect(reasonOf(input({ fouineReviews: [review({ state: "CHANGES_REQUESTED" })], findings: [] }))).toBe(
    "blocking",
  );
});

test("refuses when severities can't be verified", () => {
  // No rows at all for that review.
  expect(reasonOf(input({ findings: [] }))).toBe("unverifiable");
  // Rows exist, but for a different GitHub review.
  expect(reasonOf(input({ findings: [finding({ github_review_id: 999 })] }))).toBe("unverifiable");
  // An inline row with no severity is never read as a nit.
  expect(reasonOf(input({ findings: [finding({ severity: null })] }))).toBe("unverifiable");
});

test("uses the latest review on the head, not an older one", () => {
  const older = review({ id: 50, state: "CHANGES_REQUESTED", submitted_at: "2025-12-01T00:00:00Z" });
  expect(reasonOf(input({ fouineReviews: [review(), older] }))).toBe("approve");
  const newerBlocking = review({ id: 200, state: "CHANGES_REQUESTED", submitted_at: "2026-02-01T00:00:00Z" });
  expect(reasonOf(input({ fouineReviews: [review(), newerBlocking] }))).toBe("blocking");
});

test("already approved on the head is a no-op", () => {
  expect(reasonOf(input({ fouineReviews: [review({ state: "APPROVED" })], findings: [] }))).toBe(
    "already-approved",
  );
});

test("approval body names the author and lists skipped findings, bounded", () => {
  const skipped = Array.from({ length: 23 }, (_, i) =>
    finding({ id: i, line: i, body: `\nFirst line ${i}\nsecond line` }),
  );
  const body = renderSkipNitsApproval({
    author: "alice",
    headSha: HEAD,
    reviewUrl: "https://github.example/r/100",
    skipped,
  });
  expect(body).toContain("`/fouine skip nits` by @alice");
  expect(body).toContain("`head123`");
  expect(body).toContain("- `src/a.ts:0` (nit) First line 0");
  expect(body).not.toContain("second line");
  expect(body).not.toContain("First line 20");
  expect(body).toContain("…and 3 more");
});

// ─── pipeline, against a fake GitHubService ────────────────────────────────

function fakeLayer(opts: { author?: string; state?: string; commit?: string }) {
  const calls = { approvals: [] as { commitId: string; body: string }[], comments: [] as string[] };
  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    botLogin: () => Effect.succeed("fouine[bot]"),
    getPull: () =>
      Effect.succeed({
        headSha: HEAD,
        baseRef: "main",
        draft: false,
        mergeable: true,
        merged: false,
        author: opts.author ?? "alice",
        title: "t",
        body: "",
      }),
    listReviews: () =>
      Effect.succeed([
        {
          id: 100,
          user: "fouine[bot]",
          state: opts.state ?? "COMMENTED",
          submitted_at: "2026-01-01T00:00:00Z",
          html_url: "https://github.example/r/100",
          body: "Two nits.",
          commit_id: opts.commit ?? HEAD,
        },
        // Someone else's approval must not be mistaken for fouine's.
        {
          id: 101,
          user: "bob",
          state: "APPROVED",
          submitted_at: "2026-01-02T00:00:00Z",
          html_url: "https://github.example/r/101",
          body: "",
          commit_id: HEAD,
        },
      ]),
    approvePull: (_o: unknown, _ow: unknown, _r: unknown, _pr: unknown, commitId: string, body: string) =>
      Effect.sync(() => {
        calls.approvals.push({ commitId, body });
        return 555;
      }),
    createIssueComment: (_o: unknown, _ow: unknown, _r: unknown, _pr: unknown, body: string) =>
      Effect.sync(() => {
        calls.comments.push(body);
      }),
  } as unknown as GitHubServiceShape);
  return { gh, calls };
}

function seed(full: string, pr: number, severity: string | null) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  const row = reviews.insert.get({
    $repo: full,
    $pr: pr,
    $title: "t",
    $session: null,
    $status: "completed",
    $trigger: null,
    $attempt: 0,
  })!;
  for (const [kind, sev] of [
    ["summary", null],
    ["inline", severity],
  ] as const) {
    findings.insert.run({
      $review: row.id,
      $repo: full,
      $pr: pr,
      $kind: kind,
      $severity: sev,
      $event: kind === "summary" ? "COMMENT" : null,
      $path: kind === "inline" ? "src/a.ts" : null,
      $line: kind === "inline" ? 7 : null,
      $body: kind === "inline" ? "Consider renaming." : "Two nits.",
      $github_review_id: 100,
      $github_comment_id: null,
    });
  }
  return row.id;
}

test("pipeline: approves pinned to the reviewed commit and records the dismissal", async () => {
  const full = "acme/skip-ok";
  const reviewId = seed(full, 1, "nit");
  const { gh, calls } = fakeLayer({});
  const reaction = await Effect.runPromise(
    skipNitsPipeline({ repoFullName: full, prNumber: 1, installationId: 1, commenter: "alice" }, () => false).pipe(
      Effect.provide(gh),
    ),
  );
  expect(reaction).toBe("+1");
  expect(calls.comments).toEqual([]);
  expect(calls.approvals).toHaveLength(1);
  expect(calls.approvals[0].commitId).toBe(HEAD);
  expect(calls.approvals[0].body).toContain("`src/a.ts:7` (nit) Consider renaming.");
  expect(nitDismissals.byRepoPR.all({ $repo: full, $pr: 1 })).toEqual([
    expect.objectContaining({
      review_id: reviewId,
      github_review_id: 100,
      approval_github_review_id: 555,
      head_sha: HEAD,
      dismissed_by: "alice",
    }),
  ]);
});

test("pipeline: a refusal replies, reacts confused and posts no approval", async () => {
  const full = "acme/skip-blocking";
  seed(full, 2, "blocking");
  const { gh, calls } = fakeLayer({});
  const reaction = await Effect.runPromise(
    skipNitsPipeline({ repoFullName: full, prNumber: 2, installationId: 1, commenter: "alice" }, () => false).pipe(
      Effect.provide(gh),
    ),
  );
  expect(reaction).toBe("confused");
  expect(calls.approvals).toEqual([]);
  expect(calls.comments).toHaveLength(1);
  expect(calls.comments[0]).toContain("blocking");
  expect(nitDismissals.byRepoPR.all({ $repo: full, $pr: 2 })).toEqual([]);
});

test("pipeline: already approved by fouine reacts only", async () => {
  const full = "acme/skip-approved";
  const { gh, calls } = fakeLayer({ state: "APPROVED" });
  const reaction = await Effect.runPromise(
    skipNitsPipeline({ repoFullName: full, prNumber: 3, installationId: 1, commenter: "alice" }, () => false).pipe(
      Effect.provide(gh),
    ),
  );
  expect(reaction).toBe("confused");
  expect(calls.approvals).toEqual([]);
  expect(calls.comments).toEqual([]);
});
