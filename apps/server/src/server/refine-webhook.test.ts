import { test, expect, mock, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { repos, settings } from "~/db";
import { SETTINGS } from "~/settings";

const REPO = "acme/refine-test";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function sign(payload: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(payload).digest("hex");
}

// Same shape as merge-webhook.test.ts: stub only the entry points the webhook
// layer routes to, keep getApp() real so signature verification and event
// routing run for real. Spread the real modules — mock.module is process-wide
// and a partial mock would strip exports other files import.
const actualReview = await import("~/review");
const runRefine = mock(async (_t: { repoFullName: string; issueNumber: number }) => {});
const runReviewForPR = mock(async () => {});
const abortRefinesForIssue = mock((_repo: string, _issue: number) => 1);
mock.module("~/review", () => ({
  ...actualReview,
  runRefine,
  runReviewForPR,
  abortRefinesForIssue,
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

const { verifyAndDispatch, isRefineCommand } = await import("~/server/webhook");


function setRepo(enabled: number, refineEnabled: number | null) {
  repos.upsert.run({ $full_name: REPO, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: REPO,
    $prompt: null,
    $model: null,
    $enabled: enabled,
    $deny_test_commands: null,
    $auto_merge: null,
    $merge_method: null,
    $refine_enabled: refineEnabled,
    $refine_prompt: null, $implement_enabled: null, $implement_label: null, $implement_prompt: null,
  });
}

async function dispatch(name: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  await verifyAndDispatch({ id: "1", name, payload: body, signature: sign(body) });
}

const issueOpened = (number = 42) => ({
  action: "opened",
  installation: { id: 1 },
  repository: { full_name: REPO },
  issue: { number },
});

const comment = (body: string, isPR: boolean, number = 42) => ({
  action: "created",
  installation: { id: 1 },
  repository: { full_name: REPO },
  comment: { id: 99, body },
  issue: { number, ...(isPR ? { pull_request: { url: "x" } } : {}) },
});

beforeEach(() => {
  runRefine.mockClear();
  runReviewForPR.mockClear();
  abortRefinesForIssue.mockClear();
  settings.del.run({ $key: SETTINGS.REFINE_ENABLED });
});

test("isRefineCommand: exactly `refine`, nothing else", () => {
  expect(isRefineCommand("/fouine refine")).toBe(true);
  expect(isRefineCommand("  /fouine   refine ")).toBe(true);
  expect(isRefineCommand("/review refine")).toBe(true);
  expect(isRefineCommand("/fouine refinery")).toBe(false);
  expect(isRefineCommand("/fouine refine this please")).toBe(false);
  expect(isRefineCommand("refine")).toBe(false);
});

test("issues opened refines when the repo opted in", async () => {
  setRepo(1, 1);
  await dispatch("issues", issueOpened());
  expect(runRefine).toHaveBeenCalledTimes(1);
  expect(runRefine.mock.calls[0][0]).toMatchObject({ repoFullName: REPO, issueNumber: 42 });
});

test("issues opened does nothing when refine is off (the default)", async () => {
  setRepo(1, null);
  await dispatch("issues", issueOpened());
  expect(runRefine).not.toHaveBeenCalled();
});

test("the global refine setting is the fallback when the repo has no override", async () => {
  setRepo(1, null);
  settings.set.run({ $key: SETTINGS.REFINE_ENABLED, $value: "1" });
  await dispatch("issues", issueOpened());
  expect(runRefine).toHaveBeenCalledTimes(1);
});

test("a disabled repo is never refined, even opted in", async () => {
  setRepo(0, 1);
  await dispatch("issues", issueOpened());
  expect(runRefine).not.toHaveBeenCalled();
});

test("`/fouine refine` on a true issue runs regardless of the refine toggle", async () => {
  setRepo(1, 0);
  await dispatch("issue_comment", comment("/fouine refine", false));
  expect(runRefine).toHaveBeenCalledTimes(1);
  expect(runReviewForPR).not.toHaveBeenCalled();
});

test("`/fouine stop` on a true issue aborts refines, not PR reviews", async () => {
  setRepo(1, 1);
  await dispatch("issue_comment", comment("/fouine stop", false));
  expect(abortRefinesForIssue).toHaveBeenCalledTimes(1);
  expect(abortRefinesForIssue.mock.calls[0]).toEqual([REPO, 42]);
  expect(runRefine).not.toHaveBeenCalled();
});

test("a plain `/fouine` on a true issue does nothing — no review of an issue", async () => {
  setRepo(1, 1);
  await dispatch("issue_comment", comment("/fouine", false));
  expect(runRefine).not.toHaveBeenCalled();
  expect(runReviewForPR).not.toHaveBeenCalled();
});

// The PR path must be untouched by the issue branch.
test("`/fouine` on a pull request still queues a review", async () => {
  setRepo(1, 1);
  await dispatch("issue_comment", comment("/fouine", true));
  expect(runRefine).not.toHaveBeenCalled();
  expect(runReviewForPR).toHaveBeenCalledTimes(1);
});
