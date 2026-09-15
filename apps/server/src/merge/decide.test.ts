import { test, expect } from "bun:test";
import { shouldMerge, latestFouineReview, type MergeState } from "~/merge/decide";

const SHA = "abc1234";

function baseState(overrides: Partial<MergeState> = {}): MergeState {
  return {
    armedSha: SHA,
    headSha: SHA,
    draft: false,
    mergeable: true,
    fouineReviews: [{ user: "fouine[bot]", state: "APPROVED", submitted_at: "2026-01-01T00:00:00Z" }],
    humanReviews: [],
    checks: [{ name: "ci", status: "completed", conclusion: "success" }],
    statuses: [],
    requiredChecks: null,
    ...overrides,
  };
}

test("merges when every condition holds", () => {
  expect(shouldMerge(baseState())).toEqual({ ok: true });
});

test("blocks when the head has moved since arming", () => {
  const d = shouldMerge(baseState({ headSha: "different" }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(false);
});

test("blocks a draft PR", () => {
  const d = shouldMerge(baseState({ draft: true }));
  expect(d.ok).toBe(false);
});

test("blocks when GitHub says not mergeable", () => {
  const d = shouldMerge(baseState({ mergeable: false }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(false);
});

test("waits when mergeable is still null", () => {
  const d = shouldMerge(baseState({ mergeable: null }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(true);
});

test("fouine's latest review must be APPROVED — COMMENT blocks", () => {
  const d = shouldMerge(
    baseState({ fouineReviews: [{ user: "fouine[bot]", state: "COMMENT", submitted_at: "2026-01-01" }] }),
  );
  expect(d.ok).toBe(false);
});

test("fouine's latest review must be APPROVED — REQUEST_CHANGES blocks", () => {
  const d = shouldMerge(
    baseState({
      fouineReviews: [{ user: "fouine[bot]", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01" }],
    }),
  );
  expect(d.ok).toBe(false);
});

test("a PENDING fouine review is ignored, an earlier APPROVED still counts", () => {
  const d = shouldMerge(
    baseState({
      fouineReviews: [
        { user: "fouine[bot]", state: "APPROVED", submitted_at: "2026-01-01T00:00:00Z" },
        { user: "fouine[bot]", state: "PENDING", submitted_at: null },
      ],
    }),
  );
  expect(d.ok).toBe(true);
});

test("a later APPROVED after COMMENT/REQUEST_CHANGES clears it", () => {
  const d = shouldMerge(
    baseState({
      fouineReviews: [
        { user: "fouine[bot]", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01T00:00:00Z" },
        { user: "fouine[bot]", state: "APPROVED", submitted_at: "2026-01-02T00:00:00Z" },
      ],
    }),
  );
  expect(d.ok).toBe(true);
});

test("no fouine review at all blocks", () => {
  const d = shouldMerge(baseState({ fouineReviews: [] }));
  expect(d.ok).toBe(false);
});

test("a human CHANGES_REQUESTED blocks even with fouine APPROVED", () => {
  const d = shouldMerge(
    baseState({
      humanReviews: [{ user: "alice", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01" }],
    }),
  );
  expect(d.ok).toBe(false);
});

test("a human's later APPROVED clears their own CHANGES_REQUESTED", () => {
  const d = shouldMerge(
    baseState({
      humanReviews: [
        { user: "alice", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01T00:00:00Z" },
        { user: "alice", state: "APPROVED", submitted_at: "2026-01-02T00:00:00Z" },
      ],
    }),
  );
  expect(d.ok).toBe(true);
});

test("a human COMMENT review never blocks", () => {
  const d = shouldMerge(baseState({ humanReviews: [{ user: "alice", state: "COMMENT", submitted_at: "x" }] }));
  expect(d.ok).toBe(true);
});

test("neutral and skipped check conclusions count as passing", () => {
  const d = shouldMerge(
    baseState({
      checks: [
        { name: "a", status: "completed", conclusion: "neutral" },
        { name: "b", status: "completed", conclusion: "skipped" },
      ],
    }),
  );
  expect(d.ok).toBe(true);
});

test("a failed check blocks", () => {
  const d = shouldMerge(baseState({ checks: [{ name: "ci", status: "completed", conclusion: "failure" }] }));
  expect(d.ok).toBe(false);
});

test("an in-progress check waits, doesn't block", () => {
  const d = shouldMerge(baseState({ checks: [{ name: "ci", status: "in_progress", conclusion: null }] }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(true);
});

test("a pending commit status waits", () => {
  const d = shouldMerge(baseState({ checks: [], statuses: [{ name: "ci/legacy", state: "pending" }] }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(true);
});

test("a failed commit status blocks", () => {
  const d = shouldMerge(baseState({ checks: [], statuses: [{ name: "ci/legacy", state: "failure" }] }));
  expect(d.ok).toBe(false);
});

test("requiredChecks filters out a failing check that isn't required", () => {
  const d = shouldMerge(
    baseState({
      requiredChecks: ["required-ci"],
      checks: [
        { name: "required-ci", status: "completed", conclusion: "success" },
        { name: "flaky-optional", status: "completed", conclusion: "failure" },
      ],
    }),
  );
  expect(d.ok).toBe(true);
});

test("requiredChecks still blocks on a failing required check", () => {
  const d = shouldMerge(
    baseState({
      requiredChecks: ["required-ci"],
      checks: [{ name: "required-ci", status: "completed", conclusion: "failure" }],
    }),
  );
  expect(d.ok).toBe(false);
});

test("latestFouineReview ignores PENDING and picks the newest", () => {
  const latest = latestFouineReview([
    { user: "fouine[bot]", state: "COMMENT", submitted_at: "2026-01-01T00:00:00Z" },
    { user: "fouine[bot]", state: "APPROVED", submitted_at: "2026-01-02T00:00:00Z" },
    { user: "fouine[bot]", state: "PENDING", submitted_at: null },
  ]);
  expect(latest?.state).toBe("APPROVED");
});

test("requiredChecks waits when a required check has not reported at all", () => {
  const d = shouldMerge(baseState({ checks: [], statuses: [], requiredChecks: ["required-ci"] }));
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.wait).toBe(true);
});
