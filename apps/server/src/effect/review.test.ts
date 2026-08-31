import { expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { reviewPipeline, shouldPostFailureComment } from "~/effect/review";
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
  // Mirrors the real signature: `true` only when GitHub actually closed the run.
  finishCheck?: (conclusion: string) => Effect.Effect<boolean>;
  // The diff identity this push carries; undefined = helper bailed.
  patchId?: string | undefined;
  // The last successfully-reviewed diff identity for this PR, or null.
  baseline?: { id: number; patch_id: string } | null;
}) {
  const calls = {
    completed: 0,
    failed: [] as string[],
    agent: undefined as string | undefined,
    env: undefined as Record<string, string> | undefined,
    conclusions: [] as string[],
    checkBodies: [] as string[],
    checkRuns: [] as number[],
    skipped: [] as (string | null)[],
    baselineQueries: 0,
    reviewsRun: 0,
    proceeded: 0,
    comments: [] as string[],
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
    skip: (_id: number, patch: string | null) => Effect.sync(() => void calls.skipped.push(patch)),
    lastReviewedPatch: () =>
      Effect.sync(() => {
        calls.baselineQueries++;
        return over.baseline ?? null;
      }),
    status: () => Effect.succeed(over.status ?? "running"),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    installationToken: () => Effect.succeed("tok"),
    startCheck: () => Effect.succeed(77),
    finishCheck: (
      _o: unknown,
      _owner: string,
      _repo: string,
      _checkRunId: unknown,
      conclusion: string,
      body: string,
    ) =>
      Effect.suspend(() => {
        calls.conclusions.push(conclusion);
        calls.checkBodies.push(body);
        return over.finishCheck ? over.finishCheck(conclusion) : Effect.succeed(true);
      }),
    createIssueComment: (_o: unknown, _owner: string, _repo: string, _n: number, body: string) =>
      Effect.sync(() => void calls.comments.push(body)),
  } as unknown as GitHubService);

  const git = Layer.succeed(GitService, {
    ...gitOk(),
    patchId: () => Effect.succeed(over.patchId),
    ...over.git,
  } as unknown as GitService);

  const oc = Layer.succeed(OpenCodeService, {
    runReview: (
      o: { agent?: string; env?: Record<string, string> },
      _s: unknown,
      signal: AbortSignal,
    ) => {
      calls.reviewsRun++;
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
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
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
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
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
    reviewPipeline(pr, null, ctrl.signal, () => {}, () => {}).pipe(Effect.provide(layer)),
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
    reviewPipeline(pr, "synchronize", ctrl.signal, () => {}, () => {}).pipe(Effect.provide(layer)),
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
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
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
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
});

// db.complete succeeded, then finishCheck("success") swallowed a GitHub error
// and reported `false`. The review itself is fine, so the run must be retried
// and closed as a *success* — and nothing anywhere may report it as failed.
test("a swallowed check-update failure is retried and closed as success", async () => {
  let first = true;
  const { layer, calls } = makeLayer({
    finishCheck: () =>
      Effect.sync(() => {
        const closed = !first;
        first = false;
        return closed;
      }),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.completed).toBe(1);
  expect(calls.failed).toEqual([]);
  // The finaliser retried, and on a successful review the retry is a success.
  expect(calls.conclusions).toEqual(["success", "success"]);
});

// The same interleaving on a run that then failed: the check must be closed as
// a failure, and the already-settled row must not be written again.
test("a failure after complete closes the check as failure without touching the row", async () => {
  const { layer, calls } = makeLayer({
    status: "completed",
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "late boom" })),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
  expect(calls.conclusions).toEqual(["failure"]);
});

test("tool GitHub context is passed per-review, not via global process.env (#23)", async () => {
  // The context that used to be smeared onto process.env — where two concurrent
  // reviews clobbered each other — must now ride opts.env, isolated to this run.
  delete process.env.FOUINE_GITHUB_TOKEN;
  delete process.env.FOUINE_PR_NUMBER;

  const { layer, calls } = makeLayer({});
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
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

// ── Final-failure PR comment ─────────────────────────────────────────────────
// One comment, exactly when no auto-retry will follow: genuine failure on
// attempt >= 1. Everything else stays silent.

test("shouldPostFailureComment: only a genuine unsettled attempt-1 failure", () => {
  const base = { failed: true, aborted: false, settled: false, attempt: 1 };
  expect(shouldPostFailureComment(base)).toBe(true);
  expect(shouldPostFailureComment({ ...base, attempt: 0 })).toBe(false);
  expect(shouldPostFailureComment({ ...base, aborted: true })).toBe(false);
  expect(shouldPostFailureComment({ ...base, failed: false })).toBe(false);
  expect(shouldPostFailureComment({ ...base, settled: true })).toBe(false);
});

test("an attempt-1 failure posts one PR comment with the truncated error", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "x".repeat(600) })),
  });
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, "retry", noAbort(), () => {}, () => {}, 1).pipe(Effect.provide(layer)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(calls.comments.length).toBe(1);
  expect(calls.comments[0]).toContain("🦡 Review failed after an automatic retry");
  expect(calls.comments[0]).toContain("/fouine");
  // 500-char cap on the squashed error.
  expect(calls.comments[0]).toContain("x".repeat(500));
  expect(calls.comments[0]).not.toContain("x".repeat(501));
});

test("an attempt-0 failure posts no comment — the auto-retry will speak", async () => {
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "boom" })),
  });
  await Effect.runPromiseExit(
    reviewPipeline(pr, null, noAbort(), () => {}, () => {}).pipe(Effect.provide(layer)),
  );
  expect(calls.comments).toEqual([]);
});

test("an aborted attempt-1 run posts no comment", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const { layer, calls } = makeLayer({
    oc: () => Effect.fail(new OpenCodeError({ op: "runReview", cause: "AbortError" })),
  });
  await Effect.runPromiseExit(
    reviewPipeline(pr, "retry", ctrl.signal, () => {}, () => {}, 1).pipe(Effect.provide(layer)),
  );
  expect(calls.comments).toEqual([]);
});

test("a successful attempt-1 run posts no comment", async () => {
  const { layer, calls } = makeLayer({});
  const exit = await Effect.runPromiseExit(
    reviewPipeline(pr, "retry", noAbort(), () => {}, () => {}, 1).pipe(Effect.provide(layer)),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.comments).toEqual([]);
});

// ── Skip on an unchanged diff (#78) ──────────────────────────────────────────
// The pipeline decides on the *content* of the diff, not on the commits: a
// rebase-only force-push has the same patch-id and must cost nothing.

const runPipeline = (
  layer: ReturnType<typeof makeLayer>["layer"],
  trigger: string | null,
  onProceed: (id: number) => void = () => {},
) =>
  Effect.runPromiseExit(
    reviewPipeline(pr, trigger, noAbort(), () => {}, onProceed).pipe(Effect.provide(layer)),
  );

test("a matching patch-id skips the review and completes the check", async () => {
  const { layer, calls } = makeLayer({
    patchId: "abc123",
    baseline: { id: 41, patch_id: "abc123" },
  });
  const exit = await runPipeline(layer, "synchronize");

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.reviewsRun).toBe(0); // the model was never called — the point
  expect(calls.completed).toBe(0);
  expect(calls.skipped).toEqual(["abc123"]);
  // Trap 1: a silent skip leaves `fouine` pending forever and, once required in
  // branch protection, makes the PR unmergeable.
  expect(calls.conclusions).toEqual(["success"]);
  expect(calls.checkBodies[0]).toContain("review #41");
  expect(calls.checkBodies[0]).toContain("abc123");
});

test("skip does not supersede the PR's in-flight review, a real review does", async () => {
  const skipRun = makeLayer({ patchId: "abc123", baseline: { id: 41, patch_id: "abc123" } });
  let skipProceeds = 0;
  await runPipeline(skipRun.layer, "synchronize", () => skipProceeds++);
  expect(skipProceeds).toBe(0);

  const realRun = makeLayer({ patchId: "def456", baseline: { id: 41, patch_id: "abc123" } });
  let realProceeds = 0;
  await runPipeline(realRun.layer, "synchronize", () => realProceeds++);
  expect(realProceeds).toBe(1);
});

test("a different patch-id runs the full review", async () => {
  const { layer, calls } = makeLayer({
    patchId: "def456",
    baseline: { id: 41, patch_id: "abc123" },
  });
  const exit = await runPipeline(layer, "synchronize");
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.reviewsRun).toBe(1);
  expect(calls.skipped).toEqual([]);
  expect(calls.completed).toBe(1);
});

// Trap 5: no baseline means review — first review of a PR, or a legacy row from
// before the column. Also covers "the last review failed", since the query then
// returns null.
test("no baseline runs the full review", async () => {
  const { layer, calls } = makeLayer({ patchId: "abc123", baseline: null });
  const exit = await runPipeline(layer, "synchronize");
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.reviewsRun).toBe(1);
  expect(calls.skipped).toEqual([]);
});

// Trap 4: someone asking for a review after a rebase has a reason.
for (const trigger of ["command", "retry"]) {
  test(`trigger "${trigger}" reviews even when the patch-id matches`, async () => {
    const { layer, calls } = makeLayer({
      patchId: "abc123",
      baseline: { id: 41, patch_id: "abc123" },
    });
    const exit = await runPipeline(layer, trigger);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(calls.reviewsRun).toBe(1);
    expect(calls.skipped).toEqual([]);
    // The bypass is decided before the DB is touched at all.
    expect(calls.baselineQueries).toBe(0);
  });
}

// Trap 7 and friends: the helper returns undefined whenever it can't get a
// trustworthy id (diff over the cap, fetch failure, empty diff). Absence must
// mean review, and must not even look for a baseline to match against.
test("an unavailable patch-id runs the full review", async () => {
  const { layer, calls } = makeLayer({
    patchId: undefined,
    baseline: { id: 41, patch_id: "abc123" },
  });
  const exit = await runPipeline(layer, "synchronize");
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.reviewsRun).toBe(1);
  expect(calls.skipped).toEqual([]);
  expect(calls.baselineQueries).toBe(0);
});
