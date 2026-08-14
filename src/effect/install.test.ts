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

const run = (d: string, signal = new AbortController().signal) =>
  Effect.runPromiseExit(installDeps(d, signal));

test("skips entirely when the worktree has no package.json", async () => {
  const d = dir();
  const exit = await run(d);
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(existsSync(resolve(d, "node_modules"))).toBe(false);
});

test("an install failure never fails the review", async () => {
  // Unresolvable dependency => bun install exits non-zero.
  const d = dir({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { "@fouine/definitely-not-a-real-package": "9.9.9" },
    }),
  });
  const exit = await run(d);
  expect(Exit.isSuccess(exit)).toBe(true);
}, 60_000);

test("an already-aborted signal kills the install without failing the review", async () => {
  const d = dir({ "package.json": JSON.stringify({ name: "x", dependencies: { effect: "^3" } }) });
  const ctrl = new AbortController();
  ctrl.abort();
  const started = Date.now();
  const exit = await run(d, ctrl.signal);
  expect(Exit.isSuccess(exit)).toBe(true);
  // Proof the abort really reaped the subprocess rather than letting the install
  // run to completion in the background: a real install of effect takes seconds.
  expect(Date.now() - started).toBeLessThan(2000);
});

test("the timeout kills the install and never fails the review", async () => {
  const d = dir({ "package.json": JSON.stringify({ name: "x", dependencies: { effect: "^3" } }) });
  const started = Date.now();
  const exit = await Effect.runPromiseExit(
    installDeps(d, new AbortController().signal, 50),
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  // Returned on the timeout, not after a full install.
  expect(Date.now() - started).toBeLessThan(3000);
});
