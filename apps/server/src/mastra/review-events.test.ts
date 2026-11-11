import { test, expect, spyOn } from "bun:test";
import { Effect } from "effect";
import { findings, repos, reviews } from "~/db";
import { log } from "~/server/log";
import { emitReviewCompleted } from "~/mastra/review-events";
import { DbService } from "~/effect/db";

function seedReview(full: string, pr: number) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  return reviews.insert.get({
    $repo: full,
    $pr: pr,
    $title: "Test PR",
    $session: null,
    $status: "pending",
    $trigger: "opened",
    $attempt: 0,
  })!;
}

function addFinding(reviewId: number, full: string, pr: number, severity: string) {
  findings.insert.run({
    $review: reviewId,
    $repo: full,
    $pr: pr,
    $kind: "inline",
    $severity: severity,
    $event: null,
    $path: "src/a.ts",
    $line: 1,
    $body: "finding",
    $github_review_id: null,
    $github_comment_id: null,
  });
}

test("emits review.completed with repo, PR, blocking count and URL", async () => {
  const full = "mcp/event-payload";
  const review = seedReview(full, 5);
  addFinding(review.id, full, 5, "blocking");
  addFinding(review.id, full, 5, "blocking");
  addFinding(review.id, full, 5, "nit");

  const seen: Array<{ name: string; data: Record<string, unknown> }> = [];
  await emitReviewCompleted(review.id, async (name, data) => {
    seen.push({ name, data });
  });

  expect(seen).toEqual([
    {
      name: "review.completed",
      data: {
        repo: full,
        pr: 5,
        blocking: 2,
        url: `https://github.com/${full}/pull/5`,
      },
    },
  ]);
});

test("does not emit for non-PR runs (improve/refine/implement)", async () => {
  // refine/implement store an issue number in pr_number; improve stores 0.
  // Either way the payload's `/pull/<n>` link would lie (fouine review on #178).
  for (const trigger of ["improve", "refine", "implement"]) {
    const full = `mcp/event-skip-${trigger}`;
    repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
    const row = reviews.insert.get({
      $repo: full,
      $pr: 0,
      $title: "not a PR review",
      $session: null,
      $status: "pending",
      $trigger: trigger,
      $attempt: 0,
    })!;
    const seen: unknown[] = [];
    await emitReviewCompleted(row.id, async (name, data) => {
      seen.push({ name, data });
    });
    expect(seen).toEqual([]);
  }
});

test("an emit failure only logs a warning — the caller never sees it", async () => {
  const review = seedReview("mcp/event-failure", 6);
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await emitReviewCompleted(review.id, async () => {
      throw new Error("client gone");
    });
    expect(warn).toHaveBeenCalledWith("mcp review.completed emit failed", {
      review: review.id,
      error: "Error: client gone",
    });
  } finally {
    warn.mockRestore();
  }
});

test("the real emitter accepts the payload with no subscribers", async () => {
  const review = seedReview("mcp/event-real", 7);
  const warn = spyOn(log, "warn").mockImplementation(() => {});
  try {
    await emitReviewCompleted(review.id);
    // A schema mismatch or an unregistered event would land in the warning path.
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("DbService.complete still completes the review with the emit hooked in", async () => {
  const full = "mcp/event-dbservice";
  const review = seedReview(full, 8);

  await Effect.runPromise(
    Effect.flatMap(DbService, (db) =>
      db.complete(review.id, 0.01, 128, "test/model", "patch-mcp"),
    ).pipe(Effect.provide(DbService.Default)),
  );

  const row = reviews.byId.get({ $id: review.id })!;
  expect(row.status).toBe("completed");
  expect(row.cost).toBe(0.01);
});
