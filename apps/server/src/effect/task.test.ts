import { expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { OpenCodeError } from "~/effect/errors";
import { taskPipeline } from "~/effect/task";

function makeLayer(
  over: {
    text?: string;
    hasChanges?: boolean;
    status?: string;
    oc?: () => Effect.Effect<never, OpenCodeError>;
  } = {},
) {
  const calls = {
    completed: undefined as
      | { outcome: string; url: string | null; text: string | null }
      | undefined,
    failed: [] as string[],
    agent: undefined as string | undefined,
    fetchedRef: undefined as string | undefined,
    committed: false,
    pushedBranch: undefined as string | undefined,
    createdPr: undefined as { title: string; head: string; base: string; body: string } | undefined,
    started: undefined as string | undefined,
    ran: false,
  };

  const row = {
    id: 9,
    repo_full_name: "acme/widget",
    trigger: "task",
    status: over.status ?? "pending",
    title: "Upgrade next",
    task_prompt: "Upgrade next to 16.4\nkeep tests green",
  };

  const db = Layer.succeed(DbService, {
    getReview: () => Effect.succeed(row),
    getRepo: () => Effect.succeed({ installation_id: 1, model: null, implement_model: null }),
    setRunning: () => Effect.sync(() => void (calls.ran = true)),
    setSession: () => Effect.void,
    completeTask: (_id: number, done: { outcome: string; url: string | null; text: string | null }) =>
      Effect.sync(() => void (calls.completed = done)),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
    status: () => Effect.succeed("running"),
  } as unknown as DbService);

  const octokit = {
    rest: {
      pulls: {
        create: async (opts: { title: string; head: string; base: string; body: string }) => {
          calls.createdPr = opts;
          return { data: { html_url: "https://github.com/acme/widget/pull/5" } };
        },
      },
    },
  };
  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed(octokit as never),
    installationToken: () => Effect.succeed("tok"),
    defaultBranch: () => Effect.succeed("main"),
    botLogin: () => Effect.succeed("fouine[bot]"),
  } as unknown as GitHubService);
  const git = Layer.succeed(GitService, {
    ensureBare: () => Effect.succeed("bare"),
    fetchRef: (_r: string, ref: string) => Effect.sync(() => ((calls.fetchedRef = ref), "sha")),
    addWorktree: () => Effect.void,
    removeWorktree: () => Effect.void,
    hasChanges: () => Effect.succeed(over.hasChanges ?? true),
    discardChanges: () => Effect.void,
    commitAll: () => Effect.sync(() => ((calls.committed = true), "deadbeef")),
    pushHead: (_w: string, branch: string) => Effect.sync(() => void (calls.pushedBranch = branch)),
  } as unknown as GitService);
  const oc = Layer.succeed(OpenCodeService, {
    runReview: (o: { agent?: string }) => {
      calls.agent = o.agent;
      return over.oc
        ? over.oc()
        : Effect.succeed({ sessionId: "s", text: over.text ?? "added the thing", cost: 1, tokens: 2 });
    },
  } as unknown as OpenCodeService);
  return { layer: Layer.mergeAll(db, gh, git, oc), calls };
}

const run = (layer: ReturnType<typeof makeLayer>["layer"], signal = new AbortController().signal) =>
  Effect.runPromiseExit(
    taskPipeline(9, signal, (repo) => void (void repo)).pipe(Effect.provide(layer)),
  );

test("a task with changes pushes fouine/task-<id> and opens a PR with the prompt and summary", async () => {
  const { layer, calls } = makeLayer();
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.agent).toBe("fouine-task");
  expect(calls.fetchedRef).toBe("refs/heads/main");
  expect(calls.pushedBranch).toBe("fouine/task-9");
  expect(calls.createdPr?.head).toBe("fouine/task-9");
  expect(calls.createdPr?.body).toContain("> Upgrade next to 16.4");
  expect(calls.createdPr?.body).toContain("added the thing");
  expect(calls.completed).toEqual({
    cost: 1,
    tokens: 2,
    model: expect.any(String),
    outcome: "pr_opened",
    url: "https://github.com/acme/widget/pull/5",
    text: "added the thing",
  } as never);
});

test("an empty diff ends as no changes: no commit, no push, no PR", async () => {
  const { layer, calls } = makeLayer({ hasChanges: false, text: "next is not used here" });
  await run(layer);
  expect(calls.completed?.outcome).toBe("no_changes");
  expect(calls.completed?.text).toBe("next is not used here");
  expect(calls.committed).toBe(false);
  expect(calls.pushedBranch).toBeUndefined();
  expect(calls.createdPr).toBeUndefined();
});

test("the NEEDS INPUT marker ends as needs input, stores the question and never pushes", async () => {
  // hasChanges is true on purpose: a half-done diff must still not be pushed.
  const { layer, calls } = makeLayer({ text: "NEEDS INPUT: upgrade to 16.4 or 16.4.1?" });
  await run(layer);
  expect(calls.completed?.outcome).toBe("needs_input");
  expect(calls.completed?.text).toBe("upgrade to 16.4 or 16.4.1?");
  expect(calls.committed).toBe(false);
  expect(calls.pushedBranch).toBeUndefined();
  expect(calls.createdPr).toBeUndefined();
});

test("an agent failure fails the row and pushes nothing", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "boom" })),
  });
  const exit = await run(layer);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.completed).toBeUndefined();
  expect(calls.failed).toEqual(["boom"]);
  expect(calls.pushedBranch).toBeUndefined();
});

test("a row stopped while queued is left alone", async () => {
  const { layer, calls } = makeLayer({ status: "failed" });
  await run(layer);
  expect(calls.ran).toBe(false);
  expect(calls.completed).toBeUndefined();
  expect(calls.agent).toBeUndefined();
});
