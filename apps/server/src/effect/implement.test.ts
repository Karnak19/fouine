import { expect, test, mock } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { OpenCodeError } from "~/effect/errors";
import { buildImplementPrompt } from "~/review/implement-prompt";
import type { IssueInfo } from "~/review/types";
import type { ImplementTarget } from "~/effect/implement";

// fetchIssueInfo is the one raw-octokit call the pipeline makes through ~/github
// directly; stub it so the test never reaches for a real Octokit shape. Spread
// the real module so the other exports survive — mock.module is process-wide.
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

const { implementPipeline } = await import("~/effect/implement");

const target: ImplementTarget = {
  repoFullName: "acme/widget",
  installationId: 1,
  issueNumber: 12,
  issueTitle: "Add a dark mode toggle",
};

function notFound(): { status: number } {
  return { status: 404 };
}

function makeLayer(
  over: {
    oc?: () => Effect.Effect<never, OpenCodeError>;
    hasChanges?: boolean;
    branchExists?: boolean;
    existingPr?: { number: number; html_url: string };
    getRefFails?: boolean;
  } = {},
) {
  const calls = {
    completed: 0,
    failed: [] as string[],
    agent: undefined as string | undefined,
    env: undefined as Record<string, string> | undefined,
    prompt: undefined as string | undefined,
    inserted: undefined as { pr: number; trigger: string | null; title: string } | undefined,
    fetchedRef: undefined as string | undefined,
    committed: false,
    pushed: false,
    pushedBranch: undefined as string | undefined,
    createdPr: undefined as { title: string; head: string; base: string; body: string } | undefined,
    comments: [] as { issueNumber: number; body: string }[],
  };

  const db = Layer.succeed(DbService, {
    getRepo: () => Effect.succeed(null),
    insertReview: (input: { pr: number; trigger: string | null; title: string }) =>
      Effect.sync(() => {
        calls.inserted = { pr: input.pr, trigger: input.trigger, title: input.title };
        return 7;
      }),
    setRunning: () => Effect.void,
    setSession: () => Effect.void,
    complete: () => Effect.sync(() => void calls.completed++),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
    status: () => Effect.succeed("running"),
  } as unknown as DbService);

  const octokit = {
    rest: {
      git: {
        getRef: async () => {
          if (over.getRefFails) throw new Error("rate limited");
          if (over.branchExists) return { data: {} };
          throw notFound();
        },
      },
      pulls: {
        list: async () => ({ data: over.existingPr ? [over.existingPr] : [] }),
        create: async (opts: { title: string; head: string; base: string; body: string }) => {
          calls.createdPr = opts;
          return { data: { html_url: "https://github.com/acme/widget/pull/99", number: 99 } };
        },
      },
    },
  };

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed(octokit as never),
    installationToken: () => Effect.succeed("tok"),
    defaultBranch: () => Effect.succeed("main"),
    botLogin: () => Effect.succeed("fouine[bot]"),
    createIssueComment: (_octokit: unknown, _owner: string, _repo: string, issueNumber: number, body: string) =>
      Effect.sync(() => void calls.comments.push({ issueNumber, body })),
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, {
    ensureBare: () => Effect.succeed("bare"),
    fetchRef: (_repo: string, ref: string) => Effect.sync(() => ((calls.fetchedRef = ref), "sha")),
    addWorktree: () => Effect.void,
    removeWorktree: () => Effect.void,
    hasChanges: () => Effect.succeed(over.hasChanges ?? true),
    discardChanges: () => Effect.void,
    commitAll: () => Effect.sync(() => ((calls.committed = true), "deadbeef")),
    pushHead: (_worktree: string, branch: string) =>
      Effect.sync(() => ((calls.pushed = true), (calls.pushedBranch = branch))),
  } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (o: { agent?: string; env?: Record<string, string>; prompt?: string }) => {
      calls.agent = o.agent;
      calls.env = o.env;
      calls.prompt = o.prompt;
      return over.oc
        ? over.oc()
        : Effect.succeed({ sessionId: "s", text: "did the thing", cost: 1, tokens: 2 });
    },
  } as unknown as OpenCodeService);

  return { layer: Layer.mergeAll(db, gh, git, oc), calls };
}

const noAbort = () => new AbortController().signal;

test("happy path implements, commits, pushes and opens a PR", async () => {
  const { layer, calls } = makeLayer();
  await Effect.runPromise(implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)));

  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
  expect(calls.agent).toBe("fouine-implementer");
  expect(calls.inserted).toEqual({ pr: 12, trigger: "implement", title: "Add a dark mode toggle" });
  expect(calls.env?.FOUINE_PR_NUMBER).toBe("12");
  // No existing branch → checked out off the default branch.
  expect(calls.fetchedRef).toBe("refs/heads/main");
  expect(calls.committed).toBe(true);
  expect(calls.pushed).toBe(true);
  expect(calls.pushedBranch).toBe("fouine/issue-12");
  expect(calls.createdPr?.body).toContain("Closes #12");
  expect(calls.createdPr?.body).toContain("did the thing");
  const opened = calls.comments.find((c) => c.body.includes("Opened"));
  expect(opened?.body).toContain("https://github.com/acme/widget/pull/99");
});

test("no diff posts a comment and completes without pushing", async () => {
  const { layer, calls } = makeLayer({ hasChanges: false });
  await Effect.runPromise(implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)));

  expect(calls.completed).toBe(1);
  expect(calls.committed).toBe(false);
  expect(calls.pushed).toBe(false);
  expect(calls.createdPr).toBeUndefined();
  const comment = calls.comments.find((c) => c.body.includes("didn't change anything"));
  expect(comment?.body).toContain("did the thing");
});

test("an existing remote branch and open PR get a follow-up commit instead of a new PR", async () => {
  const { layer, calls } = makeLayer({
    branchExists: true,
    existingPr: { number: 55, html_url: "https://github.com/acme/widget/pull/55" },
  });
  await Effect.runPromise(implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)));

  expect(calls.fetchedRef).toBe("refs/heads/fouine/issue-12");
  expect(calls.createdPr).toBeUndefined();
  const followUp = calls.comments.find((c) => c.body.includes("Pushed another commit"));
  expect(followUp?.issueNumber).toBe(55);
  const opened = calls.comments.find((c) => c.body.includes("Opened"));
  expect(opened?.body).toContain("https://github.com/acme/widget/pull/55");
});

test("a runReview failure fails the run and never pushes", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "boom" })),
  });
  const exit = await Effect.runPromiseExit(
    implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.completed).toBe(0);
  expect(calls.failed).toEqual(["boom"]);
  expect(calls.pushed).toBe(false);
});

test("a non-404 getRef error fails the run before ever fetching a ref", async () => {
  const { layer, calls } = makeLayer({ getRefFails: true });
  const exit = await Effect.runPromiseExit(
    implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.fetchedRef).toBeUndefined();
  expect(calls.completed).toBe(0);
});

test("the row is inserted and onStart fires before fetchIssueInfo — the abort window", async () => {
  fetchIssueInfo.mockClear();
  const { layer, calls } = makeLayer();
  let startedId: number | undefined;
  await Effect.runPromise(
    implementPipeline(target, noAbort(), (id) => (startedId = id)).pipe(Effect.provide(layer)),
  );
  expect(startedId).toBe(7);
  expect(calls.inserted).toBeDefined();
});

test("a fetchIssueInfo rejection inserts the row, marks it failed, and never runs the agent", async () => {
  fetchIssueInfo.mockImplementationOnce(async () => {
    throw new Error("issue not found");
  });
  const { layer, calls } = makeLayer();

  const exit = await Effect.runPromiseExit(
    implementPipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.inserted).toBeDefined();
  expect(calls.failed).toHaveLength(1);
  expect(calls.failed[0]).toContain("issue not found");
  expect(calls.completed).toBe(0);
  expect(calls.agent).toBeUndefined();
});

test("the inserted row title is the target's issueTitle (the issue is not fetched yet)", async () => {
  const { layer, calls } = makeLayer();
  await Effect.runPromise(
    implementPipeline({ ...target, issueTitle: "Add dark mode" }, noAbort(), () => {}).pipe(
      Effect.provide(layer),
    ),
  );
  expect(calls.inserted?.title).toBe("Add dark mode");
});

test("buildImplementPrompt embeds the issue body, a comment author, the branch and asks for a 3-line summary", () => {
  const prompt = buildImplementPrompt(issue, "fouine/issue-12", null);
  expect(prompt).toContain("remember the choice");
  expect(prompt).toContain("@ana");
  expect(prompt).toContain("per device or per account?");
  expect(prompt).toContain("fouine/issue-12");
  expect(prompt).toContain("3-line summary");
  expect(buildImplementPrompt(issue, "fouine/issue-12", "be terse")).toContain("be terse");
});
