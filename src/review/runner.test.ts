import { test, expect } from "bun:test";
import { idsForKey } from "~/review/runner";

test("idsForKey returns only reviews matching the PR key", () => {
  const entries: [number, { key: string }][] = [
    [1, { key: "acme/widget#7" }],
    [2, { key: "acme/widget#8" }],
    [3, { key: "acme/widget#7" }],
    [4, { key: "other/repo#7" }],
  ];
  expect(idsForKey(entries, "acme/widget#7")).toEqual([1, 3]);
  expect(idsForKey(entries, "acme/widget#8")).toEqual([2]);
  expect(idsForKey(entries, "nope/repo#1")).toEqual([]);
});
