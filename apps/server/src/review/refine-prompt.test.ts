import { expect, test } from "bun:test";
import { buildRefinePrompt } from "~/review/refine-prompt";
import type { IssueInfo } from "~/review/types";

const issue: IssueInfo = {
  repoFullName: "acme/widget",
  number: 12,
  title: "Add a dark mode toggle",
  body: "It should remember the choice.",
  comments: [],
};

test("round 1 (default) has no Follow-up section", () => {
  const prompt = buildRefinePrompt(issue, null);
  expect(prompt).toContain("- Round: 1");
  expect(prompt).not.toContain("## Follow-up");
});

test("round 2 adds a Follow-up section before the issue body and mentions mark_issue_ready", () => {
  const prompt = buildRefinePrompt(issue, null, 2);
  expect(prompt).toContain("- Round: 2");
  expect(prompt).toContain("## Follow-up");
  expect(prompt).toContain("mark_issue_ready");
  expect(prompt).toContain("Blocking questions");
  // The Follow-up section comes before the issue body.
  expect(prompt.indexOf("## Follow-up")).toBeLessThan(prompt.indexOf("## Issue body"));
});
