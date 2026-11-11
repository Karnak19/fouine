import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { config } from "~/config";
import { mastra, mastraStoragePath } from "~/mastra";

// The test preload (`tests/setup.ts`) points DATA_DIR at a fresh temp dir before
// any singleton loads. This pins the rule that Mastra's storage follows it: a
// regression here would make every test write `mastra.db` into the real data
// volume, and the suite would stop being hermetic.
test("Mastra storage follows DATA_DIR", () => {
  const dataDir = process.env.DATA_DIR;
  expect(dataDir).toBeTruthy();
  expect(config.dataDir).toBe(resolve(dataDir!));
  expect(mastraStoragePath()).toBe(resolve(dataDir!, "mastra.db"));
});

test("the Mastra instance registers both agents and its storage", () => {
  expect(mastra.getAgent("chat")).toBeDefined();
  expect(mastra.getAgent("build")).toBeDefined();
  expect(mastra.getAgent("channel")).toBeDefined();
  expect(mastra.getStorage()).toBeDefined();
});
