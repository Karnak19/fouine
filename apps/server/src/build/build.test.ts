import { test, expect } from "bun:test";
import { createDatasetStep, rerunPreviousDataset } from "~/build/datasets";
import { streamBuild, validatePrevious, DATASET_PART, NOTE_PART } from "~/build";
import {
  DATA_SYSTEM_PROMPT,
  DATA_REFINE_PROMPT,
  layoutSystemPrompt,
  datasetBriefing,
  refineDataPrompt,
  refineLayoutPrompt,
} from "~/build/prompt";
import { MOCK_TOTALS_SQL, MOCK_STATUS_SQL } from "~/build/mock-model";
import { MAX_CATEGORIES } from "~/chat/chart";
import { requiresSession, createServer } from "~/server/app";
import { SPEC_DATA_PART_TYPE } from "@json-render/core";
import {
  MAX_DATASETS,
  MAX_PREVIOUS_PROMPTS,
  MAX_PREVIOUS_SPEC_BYTES,
  MAX_SPEC_NODES,
  MAX_SQL_CHARS,
  MAX_TABLE_ROWS,
  sanitizeSpec,
  type BuildDataset,
  type BuildPrevious,
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

// ---------------------------------------------------------------------------
// Refining: the previous dashboard comes back up, minus the rows
// ---------------------------------------------------------------------------

const PREVIOUS_SPEC: BuildPrevious["spec"] = {
  root: "page",
  elements: {
    page: { type: "Stack", props: { gap: "normal" }, children: ["tile", "chart"] },
    tile: { type: "StatTile", props: { label: "Reviews", data: "totals", column: "reviews", unit: "count" }, children: [] },
    chart: { type: "BarChart", props: { title: "By status", data: "by_status", x: "status", y: "reviews" }, children: [] },
  },
};

const previous = (over: Partial<BuildPrevious> = {}): BuildPrevious => ({
  spec: PREVIOUS_SPEC,
  datasets: [
    { key: "totals", title: "Review totals", sql: MOCK_TOTALS_SQL, shape: "value" },
    { key: "by_status", title: "Reviews by status", sql: MOCK_STATUS_SQL, shape: "bar" },
  ],
  prompts: ["show me review activity"],
  ...over,
});

test("a previous dataset the guard refuses is dropped with a note, not a 500, and carries no rows", async () => {
  process.env.CHAT_MOCK = "1";
  try {
    const res = await streamBuild(
      "add a table of reviews by trigger",
      undefined,
      "test-refine-guard",
      previous({
        datasets: [
          // What a hostile or stale client might send back: a query the guard
          // refuses. It ran through runStatsQuery like any other and lost.
          { key: "creds", title: "Credentials", sql: "SELECT value FROM settings" },
          { key: "totals", title: "Review totals", sql: MOCK_TOTALS_SQL, shape: "value" },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    const body = await res.text();

    // No dataset part for it: nothing named creds ever got rows.
    expect(body).not.toMatch(/"type":"data-build-dataset","id":"creds"/);
    expect(body).not.toContain('"key":"creds"');
    // The page is told in words — one note naming the dataset and the guard's
    // reason — and the survivor still came back with rows.
    expect(body).toContain(NOTE_PART);
    expect(body).toContain("no longer runs");
    expect(body).toContain("(creds)");
    expect(body).toContain("credentials");
    expect(body).toMatch(/"type":"data-build-dataset","id":"totals"/);
  } finally {
    delete process.env.CHAT_MOCK;
  }
});

test("the refine briefings carry SQL, keys and columns — never a row value", () => {
  const prev = previous();
  const dataBrief = refineDataPrompt("add a table", prev);
  expect(dataBrief).toContain("`totals`");
  expect(dataBrief).toContain(MOCK_TOTALS_SQL);
  expect(dataBrief).toContain("show me review activity");
  expect(dataBrief).toContain("New request: add a table");

  const rerun: BuildDataset[] = [
    {
      key: "totals",
      title: "Review totals",
      sql: MOCK_TOTALS_SQL,
      shape: "value",
      columns: ["reviews", "repos"],
      rows: [{ reviews: 4183, repos: 97 }],
      rowCount: 1,
      ms: 2,
    },
  ];
  const layoutBrief = refineLayoutPrompt("make the chart a line", prev, rerun);
  // The current spec, as YAML, and the dataset by key and column...
  expect(layoutBrief).toContain("type: BarChart");
  expect(layoutBrief).toContain("data: by_status");
  expect(layoutBrief).toContain("reviews, repos");
  expect(layoutBrief).toContain("Requested change: make the chart a line");
  // ...and not one of the numbers that came out of the database.
  expect(layoutBrief).not.toContain("4183");
  expect(layoutBrief).not.toContain("97");
  // Nor rows in the data step's briefing, which has no field to carry them.
  expect(dataBrief).not.toContain("4183");
  // The data step is told this is a refinement and to only add.
  expect(DATA_REFINE_PROMPT).toContain("REFINEMENT");
  expect(DATA_REFINE_PROMPT).toContain("do NOT fetch them again");
});

test("validatePrevious bounds sizes and refuses what does not parse, with a message the page can show", () => {
  expect(validatePrevious(previous()).datasets).toHaveLength(2);
  // Extra properties — rows most of all — are dropped, not forwarded.
  const withRows = previous();
  (withRows.datasets[0] as unknown as Record<string, unknown>).rows = [{ reviews: 1 }];
  expect("rows" in validatePrevious(withRows).datasets[0]!).toBe(false);

  expect(() => validatePrevious("nope")).toThrow("must be an object");
  expect(() => validatePrevious(previous({ spec: { root: "x", elements: {} } }))).toThrow("nothing to refine");
  expect(() =>
    validatePrevious(previous({ datasets: Array.from({ length: MAX_DATASETS + 1 }, (_, i) => ({ key: `d${i}`, title: "t", sql: "SELECT 1" })) })),
  ).toThrow(`at most ${MAX_DATASETS}`);
  expect(() =>
    validatePrevious(previous({ datasets: [{ key: "big", title: "t", sql: "SELECT " + "1,".repeat(MAX_SQL_CHARS) }] })),
  ).toThrow("too long");
  expect(() =>
    validatePrevious(previous({ datasets: [{ key: "Bad Key", title: "t", sql: "SELECT 1" }] })),
  ).toThrow("not a valid dataset key");
  expect(() => validatePrevious(previous({ prompts: Array(MAX_PREVIOUS_PROMPTS + 1).fill("p") }))).toThrow("start over");

  const huge: BuildPrevious["spec"] = { root: "t", elements: { t: { type: "Text", props: { content: "x".repeat(MAX_PREVIOUS_SPEC_BYTES), variant: "body" }, children: [] } } };
  expect(() => validatePrevious(previous({ spec: huge }))).toThrow("too large");

  // The spec is re-sanitised on the way in: a component the catalog lacks
  // reaches the layout model as a Note, never by its name.
  const smuggled = validatePrevious(
    previous({
      spec: { root: "p", elements: { p: { type: "IframeEmbed", props: { src: "https://x" }, children: [] } } },
    }),
  );
  expect(smuggled.spec.elements.p!.type).toBe("Note");
});

test("a re-run stacked bar is capped by category, like the first build — never mid-category", async () => {
  // More categories than the bar cap, each split into two series: 70 x 2 rows.
  // A cap that counts rows would stop at 60 rows = 30 categories, and worse,
  // could stop between the two halves of one category and draw it short.
  const over = MAX_CATEGORIES.bar + 10;
  const sql =
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < " +
    over +
    ") SELECT i AS cat, s AS series, i AS v FROM n CROSS JOIN (SELECT 'a' AS s UNION ALL SELECT 'b') ORDER BY i, s";
  const spec: BuildPrevious["spec"] = {
    root: "stack",
    elements: {
      // The table comes FIRST and has no axis: the lookup must skip it and
      // read `x`/`series` off the chart, or the re-run caps by row again.
      stack: { type: "Stack", props: {}, children: ["table", "chart"] },
      table: { type: "Table", props: { title: "T", data: "by_cat" }, children: [] },
      chart: {
        type: "StackedBarChart",
        props: { title: "T", data: "by_cat", x: "cat", y: "v", series: "series" },
        children: [],
      },
    },
  };

  const fresh = createDatasetStep();
  await add(fresh, { key: "by_cat", sql, shape: "stacked_bar", x: "cat", y: "v", series: "series" });
  const first = fresh.result().datasets[0]!;

  const rerun = await rerunPreviousDataset({ key: "by_cat", title: "t", sql, shape: "stacked_bar" }, spec);
  expect(rerun.ok).toBe(true);
  if (!rerun.ok) throw new Error(rerun.error);

  // Same rows as the first build: whole categories kept, the cap applied by category.
  expect(rerun.dataset.rows).toEqual(first.rows);
  const perCategory = new Map<unknown, number>();
  for (const r of rerun.dataset.rows) perCategory.set(r.cat, (perCategory.get(r.cat) ?? 0) + 1);
  expect(perCategory.size).toBe(MAX_CATEGORIES.bar);
  for (const n of perCategory.values()) expect(n).toBe(2);
  expect(rerun.dataset.note).toContain(`${MAX_CATEGORIES.bar} of ${over} categories`);
});

test("a refine re-runs the previous datasets, adds only the new one, then streams the edited spec", async () => {
  process.env.CHAT_MOCK = "1";
  try {
    const res = await streamBuild("add a table of reviews by trigger", undefined, "test-refine", previous());
    expect(res.ok).toBe(true);
    const body = await res.text();

    // The two existing datasets came back with rows, re-run from their SQL...
    expect(body).toMatch(/"type":"data-build-dataset","id":"totals"/);
    expect(body).toMatch(/"type":"data-build-dataset","id":"by_status"/);
    // ...the mock's ONE add_dataset call added the third...
    expect(body).toMatch(/"type":"data-build-dataset","id":"by_trigger"/);
    expect(body.match(/"type":"data-build-dataset","id":/g)).toHaveLength(3);
    // ...and every one of them landed before the first spec patch.
    const lastDataset = body.lastIndexOf(DATASET_PART);
    const specAt = body.indexOf(SPEC_DATA_PART_TYPE);
    expect(specAt).toBeGreaterThan(lastDataset);
    // The edited spec is a full spec: the untouched tiles are still there,
    // the bar became a line, and the new table references the new key.
    expect(body).toContain("StatTile");
    expect(body).toContain("LineChart");
    expect(body).toContain("by_trigger");
    expect(body).not.toContain("no longer runs");
  } finally {
    delete process.env.CHAT_MOCK;
  }
});

test("a fresh build seeds nothing: the step's cap counts existing datasets on a refine", async () => {
  const seed: BuildDataset[] = Array.from({ length: MAX_DATASETS }, (_, i) => ({
    key: `old${i}`,
    title: "t",
    sql: "SELECT 1",
    columns: ["v"],
    rows: [{ v: 1 }],
    rowCount: 1,
    ms: 0,
  }));
  const s = createDatasetStep(undefined, undefined, seed);
  expect(await add(s, { key: "old0" })).toContain("already exists");
  expect(await add(s, { key: "one_more" })).toContain("limit is reached");
});

test("a `previous` outside the schema is a 400 with one sentence, not a 422 echoing the spec back", async () => {
  process.env.CHAT_MOCK = "1";
  try {
    const app = await createServer();
    const post = (body: unknown) =>
      app.handle(
        new Request("http://localhost/api/build", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    // Too many prompts: caught by TypeBox before the handler runs.
    const schema = await post({ prompt: "x", previous: { ...previous(), prompts: Array(MAX_PREVIOUS_PROMPTS + 1).fill("p") } });
    expect(schema.status).toBe(400);
    const schemaBody = (await schema.json()) as { error: string };
    expect(schemaBody.error).toContain("does not fit");
    expect(schemaBody.error.length).toBeLessThan(300);

    // A key the pattern refuses: caught by validatePrevious inside the handler.
    const bad = previous();
    bad.datasets[0]!.key = "Bad Key";
    const semantic = await post({ prompt: "x", previous: bad });
    expect(semantic.status).toBe(400);
    expect(((await semantic.json()) as { error: string }).error).toContain("not a valid dataset key");
  } finally {
    delete process.env.CHAT_MOCK;
  }
});
