import { test, expect, mock, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { repos, settings } from "~/db";
import { SETTINGS } from "~/settings";

const REPO = "acme/implement-test";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function sign(payload: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(payload).digest("hex");
}

// Same shape as refine-webhook.test.ts, deliberately a separate file: bun's
// mock.module is process-wide, and this file and refine-webhook/runner.test.ts
// must never share a run while mocking the same modules differently.
const actualReview = await import("~/review");
const runImplement = mock(async (_t: { repoFullName: string; issueNumber: number }) => {});
const runReviewForPR = mock(async () => {});
const abortRefinesForIssue = mock((_repo: string, _issue: number) => 0);
const abortImplementsForIssue = mock((_repo: string, _issue: number) => 1);
mock.module("~/review", () => ({
  ...actualReview,
  runImplement,
  runReviewForPR,
  abortRefinesForIssue,
  abortImplementsForIssue,
}));

const actualGithub = await import("~/github");
const createForIssueComment = mock(async () => ({ data: { id: 1 } }));
const createComment = mock(async () => ({ data: { id: 1 } }));
const getInstallationOctokit = mock(
  async () =>
    ({ rest: { reactions: { createForIssueComment }, issues: { createComment } } }) as never,
);
const fetchPRInfo = mock(async () => ({ repoFullName: REPO, number: 42 }) as never);
mock.module("~/github", () => ({ ...actualGithub, getInstallationOctokit, fetchPRInfo }));

const { verifyAndDispatch, isImplementCommand } = await import("~/server/webhook");

function setRepo(
  enabled: number,
  implementEnabled: number | null,
  implementLabel: string | null = null,
) {
  repos.upsert.run({ $full_name: REPO, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: REPO,
    $prompt: null,
    $model: null,
    $enabled: enabled,
    $deny_test_commands: null,
    $auto_merge: null,
    $merge_method: null,
    $refine_enabled: null,
    $refine_prompt: null,
    $implement_enabled: implementEnabled,
    $implement_label: implementLabel,
    $implement_prompt: null,
  });
}

async function dispatch(name: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  await verifyAndDispatch({ id: "1", name, payload: body, signature: sign(body) });
}

const issueLabeled = (label: string, number = 42) => ({
  action: "labeled",
  installation: { id: 1 },
  repository: { full_name: REPO },
  issue: { number, title: "Add dark mode" },
  label: { name: label },
});

const comment = (body: string, isPR: boolean, number = 42) => ({
  action: "created",
  installation: { id: 1 },
  repository: { full_name: REPO },
  comment: { id: 99, body },
  issue: { number, title: "Add dark mode", ...(isPR ? { pull_request: { url: "x" } } : {}) },
});

beforeEach(() => {
  runImplement.mockClear();
  runReviewForPR.mockClear();
  abortRefinesForIssue.mockClear();
  abortImplementsForIssue.mockClear();
  settings.del.run({ $key: SETTINGS.IMPLEMENT_ENABLED });
  settings.del.run({ $key: SETTINGS.IMPLEMENT_LABEL });
});

test("isImplementCommand: exactly `implement`, nothing else", () => {
  expect(isImplementCommand("/fouine implement")).toBe(true);
  expect(isImplementCommand("  /fouine   implement ")).toBe(true);
  expect(isImplementCommand("/review implement")).toBe(true);
  expect(isImplementCommand("/fouine implementation")).toBe(false);
  expect(isImplementCommand("/fouine implement this please")).toBe(false);
  expect(isImplementCommand("implement")).toBe(false);
});

test("issue labeled with the default label implements when the repo opted in", async () => {
  setRepo(1, 1);
  await dispatch("issues", issueLabeled("fouine-ready"));
  expect(runImplement).toHaveBeenCalledTimes(1);
  expect(runImplement.mock.calls[0][0]).toMatchObject({
    repoFullName: REPO,
    issueNumber: 42,
    issueTitle: "Add dark mode",
  });
});

test("a different label does nothing", async () => {
  setRepo(1, 1);
  await dispatch("issues", issueLabeled("bug"));
  expect(runImplement).not.toHaveBeenCalled();
});

test("labeled with the right label but implement off (the default) does nothing", async () => {
  setRepo(1, null);
  await dispatch("issues", issueLabeled("fouine-ready"));
  expect(runImplement).not.toHaveBeenCalled();
});

test("the global implement setting is the fallback when the repo has no override", async () => {
  setRepo(1, null);
  settings.set.run({ $key: SETTINGS.IMPLEMENT_ENABLED, $value: "1" });
  await dispatch("issues", issueLabeled("fouine-ready"));
  expect(runImplement).toHaveBeenCalledTimes(1);
});

test("a per-repo implement_label override matches its own label, not the default", async () => {
  setRepo(1, 1, "ship-it");
  await dispatch("issues", issueLabeled("ship-it"));
  expect(runImplement).toHaveBeenCalledTimes(1);
  runImplement.mockClear();
  await dispatch("issues", issueLabeled("fouine-ready"));
  expect(runImplement).not.toHaveBeenCalled();
});

test("a disabled repo is never implemented, even opted in and correctly labeled", async () => {
  setRepo(0, 1);
  await dispatch("issues", issueLabeled("fouine-ready"));
  expect(runImplement).not.toHaveBeenCalled();
});

test("`/fouine implement` on a true issue runs regardless of the implement toggle", async () => {
  setRepo(1, 0);
  await dispatch("issue_comment", comment("/fouine implement", false));
  expect(runImplement).toHaveBeenCalledTimes(1);
  expect(runImplement.mock.calls[0][0]).toMatchObject({ issueNumber: 42, issueTitle: "Add dark mode" });
  expect(runReviewForPR).not.toHaveBeenCalled();
});

test("`/fouine implement` on a pull request does not run the implementer", async () => {
  setRepo(1, 1);
  await dispatch("issue_comment", comment("/fouine implement", true));
  expect(runImplement).not.toHaveBeenCalled();
  expect(runReviewForPR).toHaveBeenCalledTimes(1);
});

test("`/fouine stop` on an issue aborts both refines and implements", async () => {
  setRepo(1, 1);
  await dispatch("issue_comment", comment("/fouine stop", false));
  expect(abortRefinesForIssue).toHaveBeenCalledTimes(1);
  expect(abortImplementsForIssue).toHaveBeenCalledTimes(1);
  expect(abortRefinesForIssue.mock.calls[0]).toEqual([REPO, 42]);
  expect(abortImplementsForIssue.mock.calls[0]).toEqual([REPO, 42]);
  expect(runImplement).not.toHaveBeenCalled();
});
