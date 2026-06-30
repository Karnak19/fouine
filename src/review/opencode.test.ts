import { test, expect } from "bun:test";
import { freePort } from "~/review/opencode";

test("freePort returns a usable ephemeral port", async () => {
  const port = await freePort();
  expect(Number.isInteger(port)).toBe(true);
  expect(port).toBeGreaterThan(0);
  expect(port).toBeLessThanOrEqual(65535);
});
