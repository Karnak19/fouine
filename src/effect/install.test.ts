import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { installDeps } from "~/effect/install";

const dir = (files: Record<string, string> = {}) => {
  const d = mkdtempSync(resolve(tmpdir(), "fouine-install-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(resolve(d, name), body);
  return d;
};

// A dependency that cannot resolve WITHOUT touching the network: bun reports
// "Could not find package.json for file:..." and exits non-zero in ~20ms. The
// repo's test contract is hermetic (AGENTS.md: no network, no real services), and
// a registry lookup here would let an offline or firewalled runner sit for the
// full install timeout before the gate passes.
const unresolvable = () =>
  dir({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { "local-missing": "file:./does-not-exist" },
    }),
  });

const run = (d: string, signal = new AbortController().signal) =>
  Effect.runPromiseExit(installDeps(d, signal));

test("skips entirely when the worktree has no package.json", async () => {
  const d = dir();
  const exit = await run(d);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(existsSync(resolve(d, "node_modules"))).toBe(false);
});

test("an install failure never fails the review", async () => {
  const exit = await run(unresolvable());
  expect(Exit.isSuccess(exit)).toBe(true);
});

test("an already-aborted signal kills the install without failing the review", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const started = Date.now();
  const exit = await run(unresolvable(), ctrl.signal);
  expect(Exit.isSuccess(exit)).toBe(true);
  // The abort path returns promptly rather than leaving the subprocess running in
  // the background; it must not wait out the install timeout.
  expect(Date.now() - started).toBeLessThan(2000);
});

test("the timeout kills the install and never fails the review", async () => {
  // 1ms, not 50: the hermetic manifest fails in ~20ms, so a larger window could
  // let the install finish first and this would silently stop testing the timeout.
  const started = Date.now();
  const exit = await Effect.runPromiseExit(
    installDeps(unresolvable(), new AbortController().signal, 1),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(Date.now() - started).toBeLessThan(3000);
});
