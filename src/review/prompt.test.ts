import { test, expect } from "bun:test";
import { buildPrompt, DEFAULT_PROMPT } from "~/review/prompt";
import type { PullRequestInfo } from "~/review/types";

const pr: PullRequestInfo = {
  installationId: 1,
  repoFullName: "acme/widgets",
  number: 42,
  title: "Add flux capacitor",
  headRef: "feature/flux",
  baseRef: "main",
  headSha: "headsha0000000000000000000000000000000000",
  baseSha: "basesha0000000000000000000000000000000000",
};

test("includes repo, PR number, refs, and the diff command", () => {
  const p = buildPrompt(pr, null);
  expect(p).toContain("acme/widgets");
  expect(p).toContain("#42");
  expect(p).toContain(pr.headSha);
  expect(p).toContain(pr.baseSha);
  expect(p).toContain(`git diff ${pr.baseSha}...${pr.headSha}`);
});

test("falls back to the default prompt when none provided", () => {
  expect(buildPrompt(pr, null)).toContain(DEFAULT_PROMPT);
  expect(buildPrompt(pr, "   ")).toContain(DEFAULT_PROMPT);
});

test("uses the custom prompt when provided", () => {
  const p = buildPrompt(pr, "Be ruthless about SQL injection.");
  expect(p).toContain("Be ruthless about SQL injection.");
  expect(p).not.toContain(DEFAULT_PROMPT);
});
