import { test, expect } from "bun:test";
import { renderRecap, type RecapData } from "~/merge/recap";

function baseData(overrides: Partial<RecapData> = {}): RecapData {
  return {
    method: "squash",
    mergeSha: "abc1234567",
    armedBy: "author",
    armedAt: "2026-09-15T14:02:00Z",
    approvingReviewUrl: "https://github.com/acme/repo/pull/1#pullrequestreview-1",
    approvingReviewSummary: "LGTM, ship it.",
    findingsCount: 3,
    pushesCount: 2,
    checksPassed: 5,
    checksMode: "all checks",
    fixerCommits: [],
    totalCost: 0.1234,
    ...overrides,
  };
}

test("renders the recap within 12 lines, no fixer credit", () => {
  const recap = renderRecap(baseData());
  const lines = recap.split("\n");
  expect(lines.length).toBeLessThanOrEqual(12);
  expect(recap).toContain("Squashed as `abc1234`");
  expect(recap).toContain("Armed by @author on 2026-09-15 14:02 UTC");
  expect(recap).toContain("[approved](https://github.com/acme/repo/pull/1#pullrequestreview-1)");
  expect(recap).toContain("LGTM, ship it.");
  expect(recap).toContain("Findings: 3 reported, cleared in 2 pushes.");
  expect(recap).toContain("Checks: 5 passed (all checks).");
  expect(recap).toContain("Cost: $0.1234 total on this PR.");
  expect(recap).not.toContain("Fixer:");
});

test("renders a fixer-credit line only when there are fixer commits", () => {
  const recap = renderRecap(baseData({ fixerCommits: ["def5678", "aaa1111"] }));
  expect(recap).toContain("Fixer: 2 commits by fouine /fix (def5678, aaa1111).");
});

test("singular push and singular fixer commit read naturally", () => {
  const recap = renderRecap(baseData({ pushesCount: 1, fixerCommits: ["abc0000"] }));
  expect(recap).toContain("cleared in 1 push.");
  expect(recap).toContain("Fixer: 1 commit by fouine /fix (abc0000).");
});

test("merge and rebase methods label correctly", () => {
  expect(renderRecap(baseData({ method: "merge" }))).toContain("Merged as");
  expect(renderRecap(baseData({ method: "rebase" }))).toContain("Rebased as");
});

// Snapshot: the exact fixed shape matters (it's what an author reads on the PR
// timeline), so a change here should be a deliberate diff, not an accident.
test("snapshot: full recap with fixer commits", () => {
  const recap = renderRecap(
    baseData({
      method: "merge",
      fixerCommits: ["c0ffee1"],
    }),
  );
  expect(recap).toMatchSnapshot();
});

test("snapshot: recap without fixer commits", () => {
  expect(renderRecap(baseData())).toMatchSnapshot();
});
