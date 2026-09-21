import { test, expect } from "bun:test";
import { createDatasetStep } from "~/build/datasets";
import { streamBuild, DATASET_PART, NOTE_PART } from "~/build";
import { DATA_SYSTEM_PROMPT, layoutSystemPrompt, datasetBriefing } from "~/build/prompt";
import { requiresSession } from "~/server/app";
import { SPEC_DATA_PART_TYPE } from "@json-render/core";
import {
  MAX_DATASETS,
  MAX_SPEC_NODES,
  MAX_TABLE_ROWS,
  sanitizeSpec,
  type BuildDataset,
} from "@fouine/shared/build-catalog";

// Everything below goes through the REAL guard and the REAL readonly worker,
// same as chart.test.ts. The point of /build is that it adds a second model
// step on top of that path without opening a second path to the database.

const step = () => createDatasetStep(undefined, undefined);

type AddInput = Parameters<ReturnType<typeof createDatasetStep>["tool"]["execute"] & object>[0];

const add = (s: ReturnType<typeof createDatasetStep>, input: Partial<AddInput> & { key: string }) =>
  // The AI SDK's execute takes (input, options); nothing here reads options.
  (s.tool.execute as (i: unknown, o: unknown) => Promise<string>)(
    { title: "t", sql: "SELECT 1 AS v", shape: "value", ...input },
    {},
  );

// ---------------------------------------------------------------------------
// The data step
// ---------------------------------------------------------------------------

test("a dataset comes back keyed, with its rows, columns and SQL", async () => {
  const seen: BuildDataset[] = [];
  const s = createDatasetStep(undefined, (d) => seen.push(d));
  const out = await (s.tool.execute as (i: unknown, o: unknown) => Promise<string>)(
    {
      key: "by_letter",
      title: "By letter",
      sql: "SELECT 'a' AS k, 1 AS v UNION ALL SELECT 'b', 2",
      shape: "bar",
      x: "k",
      y: "v",
    },
    {},
  );

  const { datasets } = s.result();
  expect(datasets).toHaveLength(1);
  const d = datasets[0]!;
  expect(d.key).toBe("by_letter");
  expect(d.columns).toEqual(["k", "v"]);
  expect(d.rows).toEqual([
    { k: "a", v: 1 },
    { k: "b", v: 2 },
  ]);
  expect(d.sql).toContain("SELECT 'a' AS k");
  // Streamed to the browser the moment it was ready, before any layout exists.
  expect(seen).toEqual(datasets);

  // What the MODEL is told: names and counts, never the values. This is the
  // line that stops the layout step retyping a number it saw.
  expect(out).toContain("by_letter");
  expect(out).toContain("k, v");
  expect(out).not.toContain('"v":2');
});

test("the guard still refuses what it refuses — no second path to the database", async () => {
  const s = step();
  expect(await add(s, { key: "creds", sql: "SELECT value FROM settings" })).toContain("credentials");
  expect(await add(s, { key: "schema", sql: "SELECT name FROM sqlite_master" })).toContain("off limits");
  expect(await add(s, { key: "write", sql: "DELETE FROM reviews" })).toContain("only SELECT");
  expect(s.result().datasets).toHaveLength(0);
});

test("a chart dataset must name columns that actually came back", async () => {
  const s = step();
  const out = await add(s, { key: "bad", sql: "SELECT 'a' AS k, 1 AS v", shape: "bar", x: "day", y: "v" });
  expect(out).toContain('column "day"');
  expect(out).toContain('"k"');
  expect(s.result().datasets).toHaveLength(0);
});

test("stacked bars need a series, charts need x and y", async () => {
  const s = step();
  expect(await add(s, { key: "a", shape: "stacked_bar", x: "k", y: "v" })).toContain("series");
  expect(await add(s, { key: "b", shape: "line" })).toContain("`x` and `y`");
});

test("keys are snake_case and unique", async () => {
  const s = step();
  expect(await add(s, { key: "Bad Key" })).toContain("snake_case");
  await add(s, { key: "totals" });
  expect(await add(s, { key: "totals" })).toContain("already exists");
  expect(s.result().datasets).toHaveLength(1);
});

test(`the ${MAX_DATASETS}-dataset cap keeps what exists and says so`, async () => {
  const s = step();
  for (let i = 0; i < MAX_DATASETS; i++) expect(await add(s, { key: `d${i}` })).toContain("ready");

  const refused = await add(s, { key: "one_too_many" });
  expect(refused).toContain("limit is reached");

  const { datasets, notes } = s.result();
  // Kept, not failed: the page draws the six it has.
  expect(datasets).toHaveLength(MAX_DATASETS);
  expect(notes.join(" ")).toContain(`more than ${MAX_DATASETS} datasets`);
});

test("a table dataset is capped by row and says the cap was hit", async () => {
  const s = step();
  // 60 rows out of a recursive CTE, past the 50-row table cap.
  const sql =
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60) SELECT i, i * 2 AS v FROM n";
  const out = await add(s, { key: "rows", sql, shape: "table" });
  expect(out).toContain("ready");
  const d = s.result().datasets[0]!;
  expect(d.rowCount).toBe(MAX_TABLE_ROWS);
  expect(d.note).toContain(`first ${MAX_TABLE_ROWS}`);
});

test("a chart dataset is capped by CATEGORY, so no bar is drawn missing a slice", async () => {
  const s = step();
  // 70 distinct categories, two rows each — past the 60-category bar cap.
  const sql =
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 70) " +
    "SELECT i AS k, 'x' AS s, 1 AS v FROM n UNION ALL SELECT i, 'y', 2 FROM n ORDER BY k";
  await add(s, { key: "cats", sql, shape: "stacked_bar", x: "k", y: "v", series: "s" });
  const d = s.result().datasets[0]!;
  const categories = new Set(d.rows.map((r) => r.k));
  expect(categories.size).toBe(60);
  // Whole categories only: every kept category still has both of its rows.
  expect(d.rows).toHaveLength(120);
  expect(d.note).toContain("categories");
});

// ---------------------------------------------------------------------------
// The layout step: what the model emits, and what we refuse to render
// ---------------------------------------------------------------------------

test("a spec that embeds rows has them stripped, and the page says so", () => {
  const { spec, notes } = sanitizeSpec({
    root: "chart",
    elements: {
      chart: {
        type: "BarChart",
        props: {
          title: "Invented",
          data: "by_day",
          x: "day",
          y: "cost",
          // The failure this whole design exists to prevent: the model pasting
          // numbers it remembers into the layout.
          rows: [
            { day: "2026-01-01", cost: 12.5 },
            { day: "2026-01-02", cost: 9.5 },
          ],
          total: 22,
        },
        children: [],
      },
    },
  });

  const props = spec.elements.chart!.props!;
  expect(props.rows).toBeUndefined();
  expect(props.total).toBeUndefined();
  // The reference survives; only the values are gone.
  expect(props.data).toBe("by_day");
  expect(props.y).toBe("cost");
  expect(notes.join(" ")).toContain("every number on this page comes from SQL");
});

test("a component outside the catalog degrades to a visible note, the rest renders", () => {
  const { spec, notes } = sanitizeSpec({
    root: "page",
    elements: {
      page: { type: "Stack", props: { gap: "normal" }, children: ["bogus", "ok"] },
      bogus: { type: "IframeEmbed", props: { src: "https://example.com" }, children: [] },
      ok: { type: "Text", props: { content: "Still here", variant: "body" }, children: [] },
    },
  });

  expect(spec.elements.bogus!.type).toBe("Note");
  expect(String(spec.elements.bogus!.props!.text)).toContain("IframeEmbed");
  // Nothing else was harmed, and the tree still points at it.
  expect(spec.elements.ok!.props!.content).toBe("Still here");
  expect(spec.elements.page!.children).toEqual(["bogus", "ok"]);
  expect(notes.join(" ")).toContain("does not exist");
});

test(`a spec past ${MAX_SPEC_NODES} nodes is cut and keeps rendering`, () => {
  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {};
  for (let i = 0; i < MAX_SPEC_NODES + 20; i++) {
    elements[`t${i}`] = { type: "Text", props: { content: `n${i}`, variant: "body" }, children: [] };
  }
  const { spec, notes } = sanitizeSpec({ root: "t0", elements });
  expect(Object.keys(spec.elements)).toHaveLength(MAX_SPEC_NODES);
  expect(spec.root).toBe("t0");
  expect(notes.join(" ")).toContain(`cut to ${MAX_SPEC_NODES}`);
});

test("a data-backed node with no dataset, and a dangling child, both degrade", () => {
  const { spec } = sanitizeSpec({
    root: "page",
    elements: {
      page: { type: "Stack", props: { gap: "normal" }, children: ["chart", "ghost"] },
      chart: { type: "LineChart", props: { title: "No data" }, children: [] },
    },
  });
  expect(spec.elements.chart!.type).toBe("Note");
  // A child key that never arrived is dropped rather than rendered as a hole.
  expect(spec.elements.page!.children).toEqual(["chart"]);
});

test("a missing root falls back to something renderable", () => {
  const { spec } = sanitizeSpec({
    root: "nowhere",
    elements: { only: { type: "Text", props: { content: "hi", variant: "body" }, children: [] } },
  });
  expect(spec.root).toBe("only");
});

test("an unknown dataset key is left in place for the renderer to show empty", () => {
  const { spec, notes } = sanitizeSpec(
    {
      root: "chart",
      elements: {
        chart: { type: "BarChart", props: { title: "T", data: "never_fetched", x: "k", y: "v" }, children: [] },
      },
    },
    ["totals"],
  );
  expect(spec.elements.chart!.props!.data).toBe("never_fetched");
  expect(notes.join(" ")).toContain("never_fetched");
});

// ---------------------------------------------------------------------------
// The prompts, and the whole route end to end on the mock model
// ---------------------------------------------------------------------------

test("neither prompt can do the other's job", () => {
  // The data step sees the schema and no catalog...
  expect(DATA_SYSTEM_PROMPT).toContain("reviews — one row per review run");
  expect(DATA_SYSTEM_PROMPT).not.toContain("StatTile");
  // ...the layout step sees the catalog and no schema.
  const layout = layoutSystemPrompt();
  expect(layout).toContain("StatTile");
  expect(layout).toContain("BarChart");
  expect(layout).not.toContain("repo_full_name");
});

test("the layout briefing carries columns, never rows", () => {
  const brief = datasetBriefing([
    {
      key: "totals",
      title: "Totals",
      sql: "SELECT 1",
      columns: ["reviews", "repos"],
      rows: [{ reviews: 41, repos: 3 }],
      rowCount: 1,
      ms: 1,
    },
  ]);
  expect(brief).toContain("`totals`");
  expect(brief).toContain("reviews, repos");
  expect(brief).not.toContain("41");
});

test("the whole route streams datasets first, then spec patches", async () => {
  process.env.CHAT_MOCK = "1";
  try {
    const res = await streamBuild("show me review activity", undefined, "test-build");
    expect(res.ok).toBe(true);
    const body = await res.text();

    const datasetAt = body.indexOf(DATASET_PART);
    const specAt = body.indexOf(SPEC_DATA_PART_TYPE);
    expect(datasetAt).toBeGreaterThan(-1);
    expect(specAt).toBeGreaterThan(-1);
    // The ordering the renderer depends on: rows are there before the chart
    // that wants them, so a chart never lands on a missing dataset.
    expect(datasetAt).toBeLessThan(specAt);

    // Both mock datasets came back through runStatsQuery, keyed.
    expect(body).toContain('"key":"totals"');
    expect(body).toContain('"key":"by_status"');
    // And the layout references them by key.
    expect(body).toContain("StatTile");
    expect(body).toContain("by_status");
    // Nothing went wrong badly enough to need the note channel.
    expect(body).not.toContain(NOTE_PART);
  } finally {
    delete process.env.CHAT_MOCK;
  }
});

test("an empty prompt is refused before a token is spent", async () => {
  await expect(streamBuild("   ")).rejects.toThrow("Describe the dashboard");
  await expect(streamBuild("x".repeat(5_000))).rejects.toThrow("too long");
});

test("/api/build is behind the session gate, like /api/chat", () => {
  expect(requiresSession("/api/build")).toBe(true);
  expect(requiresSession("/api/chat")).toBe(true);
  // The two that must stay reachable, or nobody can ever log in.
  expect(requiresSession("/api/auth/callback/github")).toBe(false);
  expect(requiresSession("/api/auth-status")).toBe(false);
  expect(requiresSession("/health")).toBe(false);
});
