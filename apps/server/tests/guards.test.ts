import { test, expect } from "bun:test";
import { join } from "node:path";

// The check that fails on the unfixed process: an unhandled rejection must
// cost a log line, not the process. Bun's default is to exit — which is
// exactly how the Sept 2026 crash loop worked, so this runs the real guard in
// a child bun process rather than in-process (the runner's own handlers would
// swallow the rejection either way).
test("an unhandled rejection is logged, not fatal", async () => {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "fixtures", "unhandled-rejection.ts")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(code).toBe(0);
  expect(out).toContain("SURVIVED");
  // The rejection was still reported — surviving must not mean silence.
  expect(err).toContain("unhandled rejection (survived)");
  expect(err).toContain("cleanup");
});
