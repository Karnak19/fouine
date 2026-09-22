import { expect, test, mock } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { OpenCodeError } from "~/effect/errors";
import { buildRefinePrompt } from "~/review/refine-prompt";
import type { IssueInfo } from "~/review/types";
import type { RefineTarget } from "~/effect/refine";

// fetchIssueInfo is the one raw-octokit call in the pipeline; stub it so the
// test never reaches for an Octokit shape. Spread the real module so the other
// exports (getApp, fetchPRInfo) survive — mock.module is process-wide.
const issue: IssueInfo = {
  repoFullName: "acme/widget",
  number: 12,
  title: "Add a dark mode toggle",
  body: "It should remember the choice.",
  comments: [{ author: "ana", body: "per device or per account?" }],
};
const actualGithub = await import("~/github");
const fetchIssueInfo = mock(async () => issue);
mock.module("~/github", () => ({ ...actualGithub, fetchIssueInfo }));

const { refinePipeline } = await import("~/effect/refine");

const target: RefineTarget = {
  repoFullName: "acme/widget",
  installationId: 1,
  issueNumber: 12,
  issueTitle: "Add a dark mode toggle",
};

function makeLayer(over: { oc?: () => Effect.Effect<never, OpenCodeError> } = {}) {
  const calls = {
    completed: 0,
    failed: [] as string[],
    agent: undefined as string | undefined,
    opts: undefined as Record<string, unknown> | undefined,
    prompt: undefined as string | undefined,
    inserted: undefined as { pr: number; trigger: string | null; title: string } | undefined,
    fetchedRef: undefined as string | undefined,
    // Ordering trap: registration (insert + onStart) must happen before any
    // GitHub call, so two racing triggers can't both slip past
    // supersedeInFlight. "onStart" is pushed by the test's onStart callback.
    order: [] as string[],
  };
  const db = Layer.succeed(DbService, {
    getRepo: () => Effect.succeed(null),
    insertReview: (input: { pr: number; trigger: string | null; title: string }) =>
      Effect.sync(() => {
        calls.order.push("insert");
        calls.inserted = { pr: input.pr, trigger: input.trigger, title: input.title };
        return 7;
      }),
    setRunning: () => Effect.void,
    setSession: () => Effect.void,
    complete: () => Effect.sync(() => void calls.completed++),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
    status: () => Effect.succeed("running"),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.sync(() => (calls.order.push("installationClient"), {} as never)),
    installationToken: () => Effect.succeed("tok"),
    defaultBranch: () => Effect.succeed("main"),
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, {
    ensureBare: () => Effect.succeed("bare"),
    fetchRef: (_repo: string, ref: string) => Effect.sync(() => ((calls.fetchedRef = ref), "sha")),
    addWorktree: () => Effect.void,
    removeWorktree: () => Effect.void,
  } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (o: { agent?: string; prompt?: string }) => {
      calls.agent = o.agent;
      calls.opts = o as Record<string, unknown>;
      calls.prompt = o.prompt;
      return over.oc
        ? over.oc()
        : Effect.succeed({ sessionId: "s", text: "posted", cost: 1, tokens: 2 });
    },
  } as unknown as OpenCodeService);

  return { layer: Layer.mergeAll(db, gh, git, oc), calls };
}

const noAbort = () => new AbortController().signal;

test("success path runs the refiner agent on the default branch and completes", async () => {
  const { layer, calls } = makeLayer();
  await Effect.runPromise(refinePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)));
  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
  expect(calls.agent).toBe("fouine-refiner");
  expect(calls.fetchedRef).toBe("refs/heads/main");
  // The row is keyed by the ISSUE number, not 0 like the improver's.
  expect(calls.inserted).toEqual({ pr: 12, trigger: "refine", title: issue.title });
});

// The refiner's write-back used to ride FOUINE_PR_NUMBER (= the issue number)
// in a per-run env; that plumbing is gone and the issue-number binding moves
// server-side. Nothing per-run reaches the model's bash now.
test("passes no per-review tool env to the run", async () => {
  const { layer, calls } = makeLayer();
  await Effect.runPromise(refinePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)));
  expect(calls.opts).not.toContainKey("env");
  expect(calls.agent).toBe("fouine-refiner");
  // The row is still keyed by the issue number — see the success-path test.
  expect(calls.inserted?.pr).toBe(12);
});

test("failure marks the run failed and propagates", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "boom" })),
  });
  const exit = await Effect.runPromiseExit(
    refinePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.completed).toBe(0);
  expect(calls.failed).toEqual(["boom"]);
});

test("registers (insert + onStart) before any GitHub call", async () => {
  const { layer, calls } = makeLayer();
  await Effect.runPromise(
    refinePipeline(target, noAbort(), () => calls.order.push("onStart")).pipe(Effect.provide(layer)),
  );
  expect(calls.order.indexOf("insert")).toBe(0);
  expect(calls.order.indexOf("onStart")).toBe(1);
  expect(calls.order.indexOf("installationClient")).toBeGreaterThan(1);
});

test("a fetchIssueInfo failure marks the row failed rather than leaving it pending", async () => {
  const { layer, calls } = makeLayer();
  fetchIssueInfo.mockImplementationOnce(() => Promise.reject(new Error("404 Not Found")));
  const exit = await Effect.runPromiseExit(
    refinePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.inserted).toBeDefined();
  expect(calls.completed).toBe(0);
  expect(calls.failed).toEqual(["Error: 404 Not Found"]);
});

test("prompt embeds the issue title, body and comments", () => {
  const prompt = buildRefinePrompt(issue, null);
  expect(prompt).toContain("Add a dark mode toggle");
  expect(prompt).toContain("remember the choice");
  expect(prompt).toContain("@ana");
  expect(prompt).toContain("per device or per account?");
  // The user override replaces the default focus, not the structure.
  expect(buildRefinePrompt(issue, "be terse")).toContain("be terse");
});
