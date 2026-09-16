import { expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { reconcileStaleChecks, STALE_MESSAGE } from "~/effect/reconcile";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { config } from "~/config";
import type { ReviewRow } from "@fouine/shared";

const NOW = 1_786_000_000;

function row(partial: { id: number } & Partial<ReviewRow>): ReviewRow {
  return {
    repo_full_name: "acme/widget",
    pr_number: 7,
    title: "t",
    session_id: null,
    status: "running",
    error: null,
    trigger: "synchronize",
    cost: null,
    tokens: null,
    model: null,
    check_run_id: 77,
    patch_id: null,
    attempt: 0,
    created_at: NOW - 7200,
    completed_at: null,
    ...partial,
  };
}

function makeLayer(over: {
  stale?: ReviewRow[];
  terminal?: ReviewRow[];
  findings?: boolean;
  // false = the repo row is gone (deleted repo): rows still settle, checks can't close.
  repo?: boolean;
  checkState?: "open" | "closed" | "unknown";
}) {
  const calls = {
    failed: [] as { id: number; error: string }[],
    conclusions: [] as string[],
    checkCalls: 0,
    statusCalls: 0,
    staleCutoff: 0,
  };
  const db = Layer.succeed(DbService, {
    getRepo: () =>
      Effect.succeed(
        over.repo === false
          ? null
          : { full_name: "acme/widget", installation_id: 1, prompt: null, model: null, enabled: 1 },
      ),
    staleUnfinished: (cutoff: number) =>
      Effect.sync(() => {
        calls.staleCutoff = cutoff;
        return over.stale ?? [];
      }),
    terminalWithCheck: () => Effect.succeed(over.terminal ?? []),
    fail: (id: number, error: string) =>
      Effect.sync(() => void calls.failed.push({ id, error })),
    hasFindings: () => Effect.succeed(over.findings ?? false),
  } as unknown as DbService);

  const gh = Layer.succeed(GitHubService, {
    installationClient: () => Effect.succeed({} as never),
    finishCheck: (
      _o: unknown,
      _owner: string,
      _repo: string,
      _checkRunId: unknown,
      conclusion: string,
      _body: string,
    ) =>
      Effect.sync(() => {
        calls.checkCalls++;
        calls.conclusions.push(conclusion);
        return true;
      }),
    checkStatus: () =>
      Effect.sync(() => {
        calls.statusCalls++;
        return over.checkState ?? "closed";
      }),
  } as unknown as GitHubService);

  return { layer: Layer.mergeAll(db, gh), calls };
}

const run = (layer: ReturnType<typeof makeLayer>["layer"]) =>
  Effect.runPromiseExit(reconcileStaleChecks(NOW).pipe(Effect.provide(layer)));

test("stale row with posted findings is failed but its check closed as success", async () => {
  const { layer, calls } = makeLayer({ stale: [row({ id: 1 })], findings: true });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  // The pipeline never completed, so the row is failed — but the deliverable
  // (the posted review) exists, so the check goes green.
  expect(calls.failed).toEqual([{ id: 1, error: STALE_MESSAGE }]);
  expect(calls.conclusions).toEqual(["success"]);
});

test("stale row with nothing posted closes its check as failure", async () => {
  const { layer, calls } = makeLayer({ stale: [row({ id: 2 })], findings: false });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([{ id: 2, error: STALE_MESSAGE }]);
  expect(calls.conclusions).toEqual(["failure"]);
});

test("stale row without a check run is only failed, never closed", async () => {
  const { layer, calls } = makeLayer({ stale: [row({ id: 3, check_run_id: null })] });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([{ id: 3, error: STALE_MESSAGE }]);
  expect(calls.checkCalls).toBe(0);
});

test("stale row for a deleted repo is only failed, never closed", async () => {
  const { layer, calls } = makeLayer({ stale: [row({ id: 4 })], repo: false });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([{ id: 4, error: STALE_MESSAGE }]);
  expect(calls.checkCalls).toBe(0);
});

test("terminal completed row with an open check is closed as success, row untouched", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 5, status: "completed" })],
    checkState: "open",
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
  expect(calls.conclusions).toEqual(["success"]);
});

test("terminal failed row with an open check is closed as failure", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 6, status: "failed" })],
    checkState: "open",
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
  expect(calls.conclusions).toEqual(["failure"]);
});

test("terminal failed row with posted findings and an open check closes as success", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 10, status: "failed" })],
    checkState: "open",
    findings: true,
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.failed).toEqual([]);
  expect(calls.conclusions).toEqual(["success"]);
});

test("terminal skipped row with an open check is closed as success", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 7, status: "skipped" })],
    checkState: "open",
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.conclusions).toEqual(["success"]);
});

test("terminal row whose check already closed is untouched", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 8, status: "completed" })],
    checkState: "closed",
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.checkCalls).toBe(0);
  expect(calls.failed).toEqual([]);
});

test("unknown check state is left for the next tick", async () => {
  const { layer, calls } = makeLayer({
    terminal: [row({ id: 9, status: "completed" })],
    checkState: "unknown",
  });
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls.checkCalls).toBe(0);
  expect(calls.failed).toEqual([]);
});

test("the stale cutoff sits past the watchdog ceiling", async () => {
  const { layer, calls } = makeLayer({});
  const exit = await run(layer);
  expect(Exit.isSuccess(exit)).toBe(true);
  // A legitimately running review can never be older than the absolute ceiling
  // (the watchdog kills it there), plus margin — so nothing fresh is ever failed.
  const expected = NOW - Math.ceil((config.review.timeoutMs + 15 * 60 * 1000) / 1000);
  expect(calls.staleCutoff).toBe(expected);
  expect(calls.staleCutoff).toBeLessThan(NOW);
});
