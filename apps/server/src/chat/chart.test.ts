import { test, expect } from "bun:test";
import { buildChart, MAX_CATEGORIES, type ChartInput } from "~/chat/chart";
import { MAX_ROWS } from "~/chat/query";

// Every one of these goes through the real guard and the real readonly worker,
// same as query.test.ts — the point is that the chart tool adds validation on
// top of that path without opening a second one.
const chart = (over: Partial<ChartInput>) =>
  buildChart({
    sql: "SELECT 'a' AS k, 1 AS v",
    type: "bar",
    title: "test",
    x: "k",
    y: "v",
    ...over,
  });

const failed = async (over: Partial<ChartInput>) => {
  const r = await chart(over);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
};

test("a plain bar chart comes back with its spec and rows", async () => {
  const r = await chart({
    sql: "SELECT 'a' AS k, 1 AS v UNION ALL SELECT 'b', 2",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.spec).toEqual({ type: "bar", title: "test", x: "k", y: "v" });
  expect(r.rows).toEqual([
    { k: "a", v: 1 },
    { k: "b", v: 2 },
  ]);
  expect(r.rowCount).toBe(2);
  expect(r.note).toBeUndefined();
});

test("a missing column names the columns that ARE there, so one retry can fix it", async () => {
  const err = await failed({ x: "day" });
  expect(err).toContain('"day"');
  expect(err).toContain('"k"');
  expect(err).toContain('"v"');

  expect(await failed({ y: "cost" })).toContain('"cost"');
  expect(await failed({ type: "stacked_bar", series: "nope" })).toContain('"nope"');
});

test("stacked_bar without a series is refused before the query runs", async () => {
  const err = await failed({ type: "stacked_bar", series: undefined });
  expect(err).toContain("series");
});

test("a query that returns nothing is an error, not an empty chart", async () => {
  const err = await failed({ sql: "SELECT 'a' AS k, 1 AS v WHERE 1 = 0" });
  expect(err).toContain("no rows");
});

test("guard rejections and SQL errors come back as results the model can read", async () => {
  expect(await failed({ sql: "SELECT * FROM settings" })).toContain("settings");
  expect(await failed({ sql: "SELECT 1 WHERE (DELETE FROM reviews)" })).toContain("read-only");
  expect(await failed({ sql: "SELECT k, v FROM no_such_table" })).toContain("SQL error");
});

test("a non-numeric measure is refused rather than drawn flat", async () => {
  const err = await failed({ sql: "SELECT 'a' AS k, 'lots' AS v" });
  expect(err).toContain("numeric");
});

test("categories beyond the cap are dropped, and the note says so", async () => {
  // A recursive CTE is the cheapest way to make more categories than a bar
  // chart may plot; the guard's LIMIT wrapper keeps it terminating.
  const cap = MAX_CATEGORIES.bar;
  const r = await chart({
    sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${cap + 20}) SELECT i AS k, i * 2 AS v FROM n`,
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.rowCount).toBe(cap);
  // Deterministic: the head of the model's own ordering survives.
  expect(r.rows[0]).toEqual({ k: 1, v: 2 });
  expect(r.note).toContain(`first ${cap}`);
});

test("a line chart may plot far more points than a bar chart", async () => {
  expect(MAX_CATEGORIES.line).toBeGreaterThan(MAX_CATEGORIES.bar);
  const r = await chart({
    type: "line",
    sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_CATEGORIES.bar + 20}) SELECT i AS k, i * 2 AS v FROM n`,
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.rowCount).toBe(MAX_CATEGORIES.bar + 20);
  expect(r.note).toBeUndefined();
});

test("a stacked bar keeps every series row of the categories it keeps", async () => {
  const r = await chart({
    type: "stacked_bar",
    series: "s",
    sql: "SELECT 'a' AS k, 'x' AS s, 1 AS v UNION ALL SELECT 'a', 'y', 2 UNION ALL SELECT 'b', 'x', 3",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.spec.series).toBe("s");
  expect(r.rowCount).toBe(3);
});

// `i / 10` is integer division in SQLite, so category 0 gets 9 rows (i = 1..9),
// categories 1..49 get 10 each, and the 500-row cap lands on i = 500, leaving
// category 50 holding a single slice out of ten. 51 categories is under the
// stacked cap, so the by-distinct-x trimming never runs — this is exactly the
// hole where a short bar used to be drawn as if it were real.
const cappedMidCategory = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600) SELECT i / 10 AS k, i % 10 AS s, i AS v FROM n`;

test("a stacked bar cut mid-category by the row cap drops the incomplete category", async () => {
  const r = await chart({ type: "stacked_bar", series: "s", sql: cappedMidCategory });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const cats = new Set(r.rows.map((row) => row.k));
  expect(cats.size).toBe(50);
  expect(cats.has(50)).toBe(false);
  expect(r.rowCount).toBe(MAX_ROWS - 1);
  expect(r.note).toContain("dropped");
  // Every bar that survives is whole.
  for (const k of cats) expect(r.rows.filter((row) => row.k === k).length).toBe(k === 0 ? 9 : 10);
});

test("a row cap that swallows a single category leaves nothing honest to draw", async () => {
  const err = await failed({
    type: "stacked_bar",
    series: "s",
    sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600) SELECT 'only' AS k, i AS s, i AS v FROM n`,
  });
  expect(err).toContain("Aggregate further");
});

// With one row per x the row cap cannot cut a point in half — it just returns
// fewer whole points — so a capped line only ever loses categories off the tail,
// which the by-category trimming already reports.
test("a capped line with one row per x keeps whole points and reports the category cut", async () => {
  const r = await chart({
    type: "line",
    sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600) SELECT i AS k, i AS v FROM n`,
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.rowCount).toBe(MAX_CATEGORIES.line);
  expect(r.note).toContain(`first ${MAX_CATEGORIES.line}`);
});
