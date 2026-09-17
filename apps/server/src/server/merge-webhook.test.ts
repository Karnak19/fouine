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
// Spread the real module: mock.module is process-wide and outlives this file,
// so a partial mock would strip evaluatePipeline from merge/evaluate.test.ts
// when it runs later (it does in CI's file order).
const actualEvaluate = await import("~/merge/evaluate");
const evaluateArm = mock((_repo: string, _pr: number) => Promise.resolve());
mock.module("~/merge/evaluate", () => ({ ...actualEvaluate, evaluateArm }));

// Only getInstallationOctokit is faked — getApp() stays real so the actual
// @octokit/webhooks signature verification and event routing run for real.
const createComment = mock(async (_args: { owner: string; repo: string; issue_number: number; body: string }) => ({
  data: { id: 1 },
}));
const fakeOctokit = {
  rest: {
    issues: { createComment },
  },
};
const actualGithub = await import("~/github");
const getInstallationOctokit = mock(async () => fakeOctokit as never);
mock.module("~/github", () => ({ ...actualGithub, getInstallationOctokit }));

const { verifyAndDispatch, matchTrigger, isStopCommand } = await import("~/server/webhook");

beforeEach(() => {
  evaluateArm.mockClear();
  createComment.mockClear();
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

function disableAutoMerge(full: string) {
  repos.upsert.run({ $full_name: full, $installation_id: 1, $prompt: null, $model: null });
  repos.update.run({
    $full_name: full,
    $prompt: null,
    $model: null,
    $enabled: 1,
    $deny_test_commands: null,
    $auto_merge: 0,
    $merge_method: null,
  });
}

async function dispatch(name: string, payload: object): Promise<void> {
  const body = JSON.stringify(payload);
  await verifyAndDispatch({ id: "1", name, payload: body, signature: sign(body) });
}

function pullRequestPayload(full: string, overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    installation: { id: 1 },
    repository: { full_name: full },
    pull_request: {
      number: 1,
      title: "t",
      draft: false,
      head: { ref: "feature", sha: "sha-1" },
      base: { ref: "main", sha: "base" },
    },
    ...overrides,
  };
}

test("matchTrigger recognises /fouine and the deprecated /review alias", () => {
  expect(matchTrigger("/fouine stop")).toBe("/fouine");
  expect(matchTrigger("/review stop")).toBe("/review");
  expect(matchTrigger("hello")).toBeUndefined();
});

test("isStopCommand matches only the exact stop subcommand", () => {
  expect(isStopCommand("/fouine stop")).toBe(true);
  expect(isStopCommand("/fouine stopwatch")).toBe(false);
});

test("opened on an opted-in repo arms the PR with the head sha", async () => {
  const full = "acme/auto-armed";
  enableAutoMerge(full);

  await dispatch("pull_request", pullRequestPayload(full));

  const arm = mergeArms.get.get({ $repo: full, $pr: 1 });
  expect(arm?.head_sha).toBe("sha-1");
  expect(arm?.armed_by).toBe("fouine");
});

test("opened on a draft PR does not arm", async () => {
  const full = "acme/draft-not-armed";
  enableAutoMerge(full);

  await dispatch("pull_request", {
    ...pullRequestPayload(full),
    pull_request: {
      number: 2,
      title: "t",
      draft: true,
      head: { ref: "feature", sha: "sha-2" },
      base: { ref: "main", sha: "base" },
    },
  });

  expect(mergeArms.get.get({ $repo: full, $pr: 2 })).toBeNull();
});

test("opened on a repo with auto_merge off does not arm", async () => {
  const full = "acme/auto-merge-off";
  disableAutoMerge(full);

  await dispatch("pull_request", {
    ...pullRequestPayload(full),
    pull_request: {
      number: 3,
      title: "t",
      draft: false,
      head: { ref: "feature", sha: "sha-3" },
      base: { ref: "main", sha: "base" },
    },
  });

  expect(mergeArms.get.get({ $repo: full, $pr: 3 })).toBeNull();
});

test("synchronize re-arms with the new sha and posts no comment", async () => {
  const full = "acme/re-arm-on-push";
  enableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 4, $sha: "old-sha", $by: "fouine" });

  await dispatch("pull_request", {
    action: "synchronize",
    installation: { id: 1 },
    repository: { full_name: full },
    pull_request: {
      number: 4,
      title: "t",
      draft: false,
      head: { ref: "feature", sha: "new-sha" },
      base: { ref: "main", sha: "base" },
    },
  });

  const arm = mergeArms.get.get({ $repo: full, $pr: 4 });
  expect(arm?.head_sha).toBe("new-sha");
  expect(createComment).not.toHaveBeenCalled();
});

test("pull_request closed drops the arm silently (no comment)", async () => {
  const full = "acme/disarm-on-close";
  mergeArms.arm.run({ $repo: full, $pr: 9, $sha: "sha", $by: "fouine" });

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
  mergeArms.arm.run({ $repo: full, $pr: 20, $sha: "sha", $by: "fouine" });

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
  mergeArms.arm.run({ $repo: full, $pr: 21, $sha: "sha-x", $by: "fouine" });
  mergeArms.arm.run({ $repo: full, $pr: 22, $sha: "sha-y", $by: "fouine" });

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
  mergeArms.arm.run({ $repo: full, $pr: 23, $sha: "sha-z", $by: "fouine" });

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
  mergeArms.arm.run({ $repo: full, $pr: 24, $sha: "sha-w", $by: "fouine" });

  await dispatch("status", {
    repository: { full_name: full },
    sha: "sha-w",
  });

  expect(evaluateArm).toHaveBeenCalledWith(full, 24);
});

test("re-evaluation events never call evaluateArm for a repo that hasn't opted in", async () => {
  const full = "acme/not-eligible-event";
  disableAutoMerge(full);
  mergeArms.arm.run({ $repo: full, $pr: 30, $sha: "sha", $by: "fouine" });

  await dispatch("status", { repository: { full_name: full }, sha: "sha" });

  expect(evaluateArm).not.toHaveBeenCalledWith(full, 30);
});
