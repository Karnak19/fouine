import { expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { reviewPipeline } from "~/effect/review";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";
import { GitError, OpenCodeError } from "~/effect/errors";
import type { PullRequestInfo } from "~/review/types";

const pr: PullRequestInfo = {
  installationId: 1,
  repoFullName: "acme/widget",
  number: 7,
  title: "t",
  headRef: "h",
  baseRef: "b",
  headSha: "sha",
  baseSha: "base",
};

// Records what the pipeline wrote, so we can assert complete-vs-fail branching.
function makeLayer(over: {
  git?: Record<string, () => Effect.Effect<unknown, unknown>>;
  oc?: (signal: AbortSignal) => Effect.Effect<never, OpenCodeError>;
}) {
  const calls = { completed: 0, failed: [] as string[] };
  const db = Layer.succeed(DbService, {
    getRepo: () => Effect.succeed(null),
    insertReview: () => Effect.succeed(42),
    setRunning: () => Effect.void,
    setSession: () => Effect.void,
    complete: () => Effect.sync(() => void calls.completed++),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    installationToken: () => Effect.succeed("tok"),
    startCheck: () => Effect.succeed(undefined),
    finishCheck: () => Effect.void,
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, { ...gitOk(), ...over.git } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (_o: unknown, _s: unknown, signal: AbortSignal) =>
      over.oc
        ? over.oc(signal)
        : Effect.succeed({ sessionId: "s", text: "ok", cost: 1, tokens: 2 }),
  } as unknown as OpenCodeService);

  return { layer: Layer.mergeAll(db, gh, git, oc), calls };
}

function gitOk() {
  return {
    ensureBare: () => Effect.succeed("bare"),
    fetchRef: () => Effect.succeed("ref"),
    addWorktree: () => Effect.void,
    removeWorktree: () => Effect.void,
  };
}

const noAbort = () => new AbortController().signal;

test("success path marks complete, never failed", async () => {
  const { layer, calls } = makeLayer({});
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
});

test("real git error propagates and marks failed with the git message", async () => {
  const { layer, calls } = makeLayer({
    git: { ensureBare: () => Effect.fail(new GitError({ op: "ensureBare", cause: "boom" })) },
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true); // propagates to caller's .catch
  expect(calls.completed).toBe(0);
  expect(calls.failed).toEqual(["boom"]);
});

test("aborted run is swallowed (success) and recorded as Stopped by user", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "AbortError" })),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, ctrl.signal, () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true); // stop is not an error
  expect(calls.failed).toEqual(["Stopped by user"]);
});
