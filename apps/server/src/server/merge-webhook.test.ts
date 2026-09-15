import { test, expect, mock, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { mergeArms, repos } from "~/db";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function sign(payload: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(payload).digest("hex");
}

// Stub the merger's own evaluation entry point — these tests only care that
// the webhook layer routes to it, not what it does once called (that's
// merge/decide.test.ts and merge/recap.test.ts). Must be mocked before
// ~/server/webhook is ever imported, since it captures the binding at import
// time.
const evaluateArm = mock((_repo: string, _pr: number) => Promise.resolve());
mock.module("~/merge/evaluate", () => ({ evaluateArm }));

// Only getInstallationOctokit is faked — getApp() stays real so the actual
// @octokit/webhooks signature verification and event routing run for real.
const createComment = mock(async (_args: { owner: string; repo: string; issue_number: number; body: string }) => ({
  data: { id: 1 },
}));
const getCollaboratorPermissionLevel = mock(async () => ({ data: { permission: "write" } }));
const pullsGet = mock(async () => ({ data: { head: { sha: "sha-armed" } } }));
const fakeOctokit = {
  rest: {
    issues: { createComment },
    repos: { getCollaboratorPermissionLevel },
    pulls: { get: pullsGet },
  },
};
const actualGithub = await import("~/github");
const getInstallationOctokit = mock(async () => fakeOctokit as never);
mock.module("~/github", () => ({ ...actualGithub, getInstallationOctokit }));

const { verifyAndDispatch, isMergeCommand, matchTrigger, isStopCommand } = await import("~/server/webhook");

beforeEach(() => {
  evaluateArm.mockClear();
  createComment.mockClear();
  getCollaboratorPermissionLevel.mockClear();
  pullsGet.mockClear();
  getInstallationOctokit.mockClear();
});

function enableAutoMerge(full: string) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: full,
    $prompt: null,
    $model: null,
    $enabled: 1,
    $deny_test_commands: null,
    $auto_merge: 1,
    $merge_method: null,
  });
}

async function dispatch(name: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  await verifyAndDispatch({ id: "1", name, payload: body, signature: sign(body) });
}

test("matchTrigger and isMergeCommand recognise /fouine merge", () => {
  expect(matchTrigger("/fouine merge")).toBe("/fouine");
  expect(isMergeCommand("/fouine merge")).toBe(true);
  expect(isMergeCommand("/review merge")).toBe(true);
  expect(isMergeCommand("/fouine merge please")).toBe(false);
});

test("stop takes precedence over merge parsing — they never both match", () => {
  expect(isStopCommand("/fouine stop")).toBe(true);
  expect(isMergeCommand("/fouine stop")).toBe(false);
  expect(isStopCommand("/fouine merge")).toBe(false);
  expect(isMergeCommand("/fouine merge")).toBe(true);
});

test("/fouine merge on a repo that hasn't opted in posts a rejection comment and arms nothing", async () => {
  const full = "acme/not-opted-in";
  await dispatch("issue_comment", {
    action: "created",
    installation: { id: 1 },
    repository: { full_name: full },
    comment: { id: 1, body: "/fouine merge", user: { login: "alice" } },
    issue: { number: 5, pull_request: {} },
  });

  expect(createComment).toHaveBeenCalledTimes(1);
  expect(String(createComment.mock.calls[0]?.[0]?.body)).toMatch(/isn't enabled/);
  expect(mergeArms.get.get({ $repo: full, $pr: 5 })).toBeNull();
});

test("/fouine merge by a commenter without write access is rejected", async () => {
  const full = "acme/no-write";
  enableAutoMerge(full);
  getCollaboratorPermissionLevel.mockResolvedValueOnce({ data: { permission: "read" } } as never);

  await dispatch("issue_comment", {
    action: "created",
    installation: { id: 1 },
    repository: { full_name: full },
    comment: { id: 1, body: "/fouine merge", user: { login: "mallory" } },
    issue: { number: 6, pull_request: {} },
  });

  expect(createComment).toHaveBeenCalledTimes(1);
  expect(String(createComment.mock.calls[0]?.[0]?.body)).toMatch(/write access/);
  expect(mergeArms.get.get({ $repo: full, $pr: 6 })).toBeNull();
});

test("/fouine merge by a collaborator with write access arms the PR and evaluates it", async () => {
  const full = "acme/armed";
  enableAutoMerge(full);

  await dispatch("issue_comment", {
    action: "created",
    installation: { id: 1 },
    repository: { full_name: full },
    comment: { id: 1, body: "/fouine merge", user: { login: "alice" } },
    issue: { number: 7, pull_request: {} },
  });

  const arm = mergeArms.get.get({ $repo: full, $pr: 7 });
  expect(arm?.head_sha).toBe("sha-armed");
  expect(arm?.armed_by).toBe("alice");
  expect(evaluateArm).toHaveBeenCalledWith(full, 7);
});

test("pull_request synchronize disarms an armed PR", async () => {
  const full = "acme/disarm-on-push";
  mergeArms.arm.run({ $repo: full, $pr: 8, $sha: "old-sha", $by: "alice" });

  await dispatch("pull_request", {
    action: "synchronize",
    installation: { id: 1 },
    repository: { full_name: full },
    pull_request: {
      number: 8,
      title: "t",
      draft: true, // keeps the review-trigger path from running in this test
      head: { ref: "feature", sha: "new-sha" },
      base: { ref: "main", sha: "base" },
    },
  });

  expect(mergeArms.get.get({ $repo: full, $pr: 8 })).toBeNull();
});

test("pull_request closed drops the arm silently (no comment)", async () => {
  const full = "acme/disarm-on-close";
  mergeArms.arm.run({ $repo: full, $pr: 9, $sha: "sha", $by: "alice" });

  await dispatch("pull_request", {
    action: "closed",
    installation: { id: 1 },
    repository: { full_name: full },
    pull_request: {
      number: 9,
      title: "t",
      draft: false,
      head: { ref: "feature", sha: "sha" },
      base: { ref: "main", sha: "base" },
    },
  });

  expect(mergeArms.get.get({ $repo: full, $pr: 9 })).toBeNull();
  expect(createComment).not.toHaveBeenCalled();
});

test("pull_request_review submitted re-evaluates an armed PR", async () => {
  const full = "acme/review-event";
  enableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 20, $sha: "sha", $by: "alice" });

  await dispatch("pull_request_review", {
    action: "submitted",
    repository: { full_name: full },
    pull_request: { number: 20 },
  });

  expect(evaluateArm).toHaveBeenCalledWith(full, 20);
});

test("check_run completed re-evaluates every armed PR whose head matches the SHA", async () => {
  const full = "acme/check-run-event";
  enableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 21, $sha: "sha-x", $by: "alice" });
  mergeArms.arm.run({ $repo: full, $pr: 22, $sha: "sha-y", $by: "alice" });

  await dispatch("check_run", {
    action: "completed",
    repository: { full_name: full },
    check_run: { head_sha: "sha-x" },
  });

  expect(evaluateArm).toHaveBeenCalledWith(full, 21);
  expect(evaluateArm).not.toHaveBeenCalledWith(full, 22);
});

test("check_suite completed re-evaluates armed PRs on that SHA", async () => {
  const full = "acme/check-suite-event";
  enableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 23, $sha: "sha-z", $by: "alice" });

  await dispatch("check_suite", {
    action: "completed",
    repository: { full_name: full },
    check_suite: { head_sha: "sha-z" },
  });

  expect(evaluateArm).toHaveBeenCalledWith(full, 23);
});

test("status events re-evaluate armed PRs on that SHA", async () => {
  const full = "acme/status-event";
  enableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 24, $sha: "sha-w", $by: "alice" });

  await dispatch("status", {
    repository: { full_name: full },
    sha: "sha-w",
  });

  expect(evaluateArm).toHaveBeenCalledWith(full, 24);
});

test("re-evaluation events never call evaluateArm for a repo that hasn't opted in", async () => {
  const full = "acme/not-eligible-event";
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  // enabled but auto_merge left off — mergeEligible must be false.
  repos.update.run({
    $full_name: full,
    $prompt: null,
    $model: null,
    $enabled: 1,
    $deny_test_commands: null,
    $auto_merge: 0,
    $merge_method: null,
  });
  mergeArms.arm.run({ $repo: full, $pr: 30, $sha: "sha", $by: "alice" });

  await dispatch("status", { repository: { full_name: full }, sha: "sha" });

  expect(evaluateArm).not.toHaveBeenCalledWith(full, 30);
});

test("/fouine merge resolves without throwing when getInstallationOctokit rejects", async () => {
  const full = "acme/octokit-down";
  enableAutoMerge(full);
  getInstallationOctokit.mockRejectedValueOnce(new Error("installation token fetch failed"));

  // Must not throw — a redelivery-loop-inducing 500 is exactly what this test
  // guards against (webhook.ts's try/catch around handleMergeCommand).
  await expect(
    dispatch("issue_comment", {
      action: "created",
      installation: { id: 1 },
      repository: { full_name: full },
      comment: { id: 1, body: "/fouine merge", user: { login: "alice" } },
      issue: { number: 40, pull_request: {} },
    }),
  ).resolves.toBeUndefined();

  expect(mergeArms.get.get({ $repo: full, $pr: 40 })).toBeNull();
});
