import { expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { buildImprovePrompt, improvePipeline, type ImproveTarget } from "~/effect/improve";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { OpenCodeError } from "~/effect/errors";

const target: ImproveTarget = {
  repoFullName: "acme/widget",
  installationId: 1,
  prNumbers: [7, 9],
};

function makeLayer(over: { oc?: () => Effect.Effect<never, OpenCodeError> }) {
  const calls = {
    completed: 0,
    failed: [] as string[],
    agent: undefined as string | undefined,
    env: undefined as Record<string, string> | undefined,
    inserted: undefined as { pr: number; trigger: string | null } | undefined,
  };
  const db = Layer.succeed(DbService, {
    getRepo: () => Effect.succeed(null),
    insertReview: (input: { pr: number; trigger: string | null }) =>
      Effect.sync(() => {
        calls.inserted = { pr: input.pr, trigger: input.trigger };
        return 42;
      }),
    setRunning: () => Effect.void,
    setSession: () => Effect.void,
    complete: () => Effect.sync(() => void calls.completed++),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    installationToken: () => Effect.succeed("tok"),
    defaultBranch: () => Effect.succeed("main"),
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, {
    ensureBare: () => Effect.succeed("bare"),
    fetchRef: () => Effect.succeed("sha"),
    addWorktree: () => Effect.void,
    removeWorktree: () => Effect.void,
  } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (o: { agent?: string; env?: Record<string, string> }) => {
      calls.agent = o.agent;
      calls.env = o.env;
      return over.oc
        ? over.oc()
        : Effect.succeed({ sessionId: "s", text: "no learnings", cost: 1, tokens: 2 });
    },
  } as unknown as OpenCodeService);

  return { layer: Layer.mergeAll(db, gh, git, oc), calls };
}

const noAbort = () => new AbortController().signal;

test("success path runs the improver agent and completes", async () => {
  const { layer, calls } = makeLayer({});
  await Effect.runPromise(
    improvePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
  expect(calls.agent).toBe("fouine-improver");
  expect(calls.inserted).toEqual({ pr: 0, trigger: "improve" });
  // Deliberately repo-scoped: no PR binding, so post_review/post_comment fail
  // loudly if the improver agent reaches for them.
  expect(calls.env).not.toContainKey("FOUINE_PR_NUMBER");
  expect(calls.env?.FOUINE_GITHUB_TOKEN).toBe("tok");
});

test("failure marks the run failed and propagates", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "boom" })),
  });
  const exit = await Effect.runPromiseExit(
    improvePipeline(target, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.completed).toBe(0);
  expect(calls.failed).toEqual(["boom"]);
});

test("prompt lists the PRs and the current notes", () => {
  const prompt = buildImprovePrompt(target, "main", "existing rules");
  expect(prompt).toContain("#7, #9");
  expect(prompt).toContain("existing rules");
  expect(buildImprovePrompt(target, "main", undefined)).toContain("none yet");
});
