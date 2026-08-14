import { test, expect } from "bun:test";
import { dayEpoch, percentile, statsFilter } from "~/server/api";

const DAY = 86400;
// 2026-08-14T00:00:00Z
const AUG14 = Date.UTC(2026, 7, 14) / 1000;

test("dayEpoch accepts real UTC days and rejects everything else", () => {
  expect(dayEpoch("2026-08-14")).toBe(AUG14);
  expect(dayEpoch("2026-01-01")).toBe(Date.UTC(2026, 0, 1) / 1000);

  // Garbage must be "no bound", never NaN — same class as the ?range=toString bug.
  for (const bad of [null, "", "lol", "2026-13-45", "2026-02-30", "2026-8-4", "14/08/2026", "2026-08-14T12:00:00Z"])
    expect(dayEpoch(bad)).toBeNull();
});

test("from/to win over range, and `to` covers its whole day", () => {
  // to is inclusive of the picked day, so it lands on the NEXT midnight and the
  // SQL's strict `<` keeps the final day's rows.
  expect(statsFilter({ to: "2026-08-14" }).$to).toBe(AUG14 + DAY);
  expect(statsFilter({ from: "2026-08-14" }).$from).toBe(AUG14);

  // Either bound alone is valid.
  expect(statsFilter({ from: "2026-08-14" }).$to).toBeNull();
  expect(statsFilter({ to: "2026-08-14" }).$from).toBeNull();

  // Precedence: a valid custom bound ignores range entirely.
  const custom = statsFilter({ range: "24h", from: "2026-01-01" });
  expect(custom.$from).toBe(Date.UTC(2026, 0, 1) / 1000);
  expect(custom.$to).toBeNull();

  // Invalid dates fall back to range rather than bounding anything.
  const bogus = statsFilter({ range: "all", from: "lol", to: "2026-13-45" });
  expect(bogus.$from).toBeNull();
  expect(bogus.$to).toBeNull();

  // Inverted window: drop the impossible upper bound instead of erroring.
  const inverted = statsFilter({ from: "2026-08-14", to: "2026-08-01" });
  expect(inverted.$from).toBe(AUG14);
  expect(inverted.$to).toBeNull();

  // No params at all stays unfiltered, so the dashboard keeps its all-time view.
  expect(statsFilter({})).toEqual({ $from: null, $to: null, $repo: null, $model: null });
});

test("percentile is null on an empty window, never NaN", () => {
  // The case that matters: an empty window is normal, and NaN would poison the
  // chart's scale and render as "NaNs".
  expect(percentile([], 0.5)).toBeNull();
  expect(percentile([], 0.95)).toBeNull();

  expect(percentile([42], 0.5)).toBe(42);
  expect(percentile([42], 0.95)).toBe(42);

  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(percentile(ten, 0.5)).toBe(5);
  expect(percentile(ten, 0.95)).toBe(10);
  // p95 must never index past the end.
  expect(percentile([1, 2], 0.99)).toBe(2);
});
