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
  status?: string;
  finishCheck?: (conclusion: string) => Effect.Effect<void, unknown>;
}) {
  const calls = {
    completed: 0,
    failed: [] as string[],
    agent: undefined as string | undefined,
    env: undefined as Record<string, string> | undefined,
    conclusions: [] as string[],
    checkRuns: [] as number[],
  };
  const db = Layer.succeed(DbService, {
    getRepo: () => Effect.succeed(null),
    insertReview: () => Effect.succeed(42),
    setRunning: () => Effect.void,
    setSession: () => Effect.void,
    setCheckRun: (_id: number, checkRunId: number) =>
      Effect.sync(() => void calls.checkRuns.push(checkRunId)),
    complete: () => Effect.sync(() => void calls.completed++),
    fail: (_id: number, error: string) => Effect.sync(() => void calls.failed.push(error)),
    status: () => Effect.succeed(over.status ?? "running"),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    installationToken: () => Effect.succeed("tok"),
    startCheck: () => Effect.succeed(undefined),
    finishCheck: (
      _o: unknown,
      _owner: string,
      _repo: string,
      _checkRunId: unknown,
      conclusion: string,
    ) =>
      Effect.suspend(() => {
        calls.conclusions.push(conclusion);
        return over.finishCheck ? over.finishCheck(conclusion) : Effect.void;
      }),
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, { ...gitOk(), ...over.git } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (
      o: { agent?: string; env?: Record<string, string> },
      _s: unknown,
      signal: AbortSignal,
    ) => {
      calls.agent = o.agent;
      calls.env = o.env;
      return over.oc
        ? over.oc(signal)
        : Effect.succeed({ sessionId: "s", text: "ok", cost: 1, tokens: 2 });
    },
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
  // Guard the wiring: the review must run on the fouine agent, whose system
  // prompt owns the output-structure + posting mechanics.
  expect(calls.agent).toBe("fouine");
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

test("supersede abort is recorded distinctly from a user stop", async () => {
  const ctrl = new AbortController();
  ctrl.abort("superseded");
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "AbortError" })),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, "synchronize", ctrl.signal, () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual(["Superseded by a newer commit"]);
});

// #60: an unexpected throw is a defect, which the old catchAll (typed channel
// only) let sail past — leaving the row at `running` forever.
test("a defect still marks the review failed", async () => {
  const { layer, calls } = makeLayer({
    git: {
      addWorktree: () =>
        Effect.sync(() => {
          throw new Error("kaboom");
        }),
    },
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.completed).toBe(0);
  expect(calls.failed.length).toBe(1);
  expect(calls.failed[0]).toContain("kaboom");
});

// The success path already wrote `completed`; a throw after it must not flip
// the row to failed.
test("a settled row is never overwritten with a failure", async () => {
  const { layer, calls } = makeLayer({
    status: "completed",
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "late boom" })),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
});

// db.complete succeeded, then finishCheck("success") threw. The finaliser must
// still close the check run — otherwise it stays in_progress forever on an
// already-completed row — without flipping that row to failed.
test("a throw after complete still closes the check run, leaving the row completed", async () => {
  const { layer, calls } = makeLayer({
    status: "completed",
    finishCheck: (conclusion) =>
      conclusion === "success"
        ? Effect.sync(() => {
            throw new Error("check api down");
          })
        : Effect.void,
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  // (a) the settled row survives untouched
  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
  // (b) checkDoneRef was never set, so the finaliser closed the run itself
  expect(calls.conclusions).toEqual(["success", "failure"]);
});

test("tool GitHub context is passed per-review, not via global process.env (#23)", async () => {
  // The context that used to be smeared onto process.env — where two concurrent
  // reviews clobbered each other — must now ride opts.env, isolated to this run.
  delete process.env.FOUINE_GITHUB_TOKEN;
  delete process.env.FOUINE_PR_NUMBER;

  const { layer, calls } = makeLayer({});
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true);

  // The per-review env carries the full FOUINE_* context, keyed to this PR/token.
  expect(calls.env).toMatchObject({
    FOUINE_GITHUB_TOKEN: "tok",
    FOUINE_REPO_OWNER: "acme",
    FOUINE_REPO_NAME: "widget",
    FOUINE_PR_NUMBER: "7",
    FOUINE_REVIEW_ID: "42",
  });

  // The pipeline itself must not touch the shared process.env — that global
  // write is the clobber the fix removes; staging onto it happens only inside
  // OpenCodeService under a mutex, right before the subprocess snapshots it.
  expect(process.env.FOUINE_GITHUB_TOKEN).toBeUndefined();
  expect(process.env.FOUINE_PR_NUMBER).toBeUndefined();
});
