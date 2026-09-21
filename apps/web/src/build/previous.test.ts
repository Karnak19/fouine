import { test, expect } from "bun:test";
import { sanitizeSpec, type BuildDataset } from "@/build/catalog";
import { errorText, previousFromDashboard } from "@/build/previous";

// The refine body is built from the SANITISED spec — the one the renderer drew,
// not the one the model emitted — and from datasets stripped to their SQL.

const datasets: Record<string, BuildDataset> = {
  totals: {
    key: "totals",
    title: "Totals",
    sql: "SELECT COUNT(*) AS reviews FROM reviews",
    shape: "value",
    columns: ["reviews"],
    rows: [{ reviews: 41 }],
    rowCount: 1,
    ms: 3,
  },
  by_day: {
    key: "by_day",
    title: "By day",
    sql: "SELECT day, COUNT(*) AS n FROM reviews GROUP BY day",
    shape: "line",
    columns: ["day", "n"],
    rows: [{ day: "mon", n: 2 }],
    rowCount: 1,
    ms: 4,
    note: "capped",
  },
  orphan: {
    key: "orphan",
    title: "No longer drawn",
    sql: "SELECT 1 AS v",
    columns: ["v"],
    rows: [{ v: 1 }],
    rowCount: 1,
    ms: 1,
  },
};

test("previous.spec is exactly what sanitizeSpec produced, not what the model emitted", () => {
  const loose = {
    root: "page",
    elements: {
      page: { type: "Stack", props: { gap: "normal" }, children: ["tile", "chart", "ghost"] },
      tile: {
        type: "StatTile",
        // The model pasted a value in; the sanitiser strips it before render.
        props: { label: "Reviews", data: "totals", column: "reviews", unit: "count", value: 41 },
        children: [],
      },
      chart: { type: "LineChart", props: { title: "T", data: "by_day", x: "day", y: "n" }, children: [] },
    },
  };
  const safe = sanitizeSpec(loose, Object.keys(datasets));
  const prev = previousFromDashboard(safe.spec, datasets, ["show activity"]);

  expect(prev.spec).toEqual(safe.spec);
  // The stripped value and the dangling child never make it back up.
  expect(prev.spec.elements.tile!.props!.value).toBeUndefined();
  expect(prev.spec.elements.page!.children).toEqual(["tile", "chart"]);
  expect(JSON.stringify(prev)).not.toContain("41");
});

test("datasets travel up without rows, only for keys the spec still references, in spec order", () => {
  const safe = sanitizeSpec({
    root: "page",
    elements: {
      page: { type: "Stack", props: { gap: "normal" }, children: ["chart", "tile"] },
      chart: { type: "LineChart", props: { title: "T", data: "by_day", x: "day", y: "n" }, children: [] },
      tile: { type: "StatTile", props: { label: "R", data: "totals", column: "reviews", unit: "count" }, children: [] },
    },
  });
  const prev = previousFromDashboard(safe.spec, datasets, ["a", "b"]);

  expect(prev.datasets.map((d) => d.key)).toEqual(["by_day", "totals"]);
  for (const d of prev.datasets) {
    expect("rows" in d).toBe(false);
    expect("ms" in d).toBe(false);
  }
  expect(prev.datasets[0]).toEqual({
    key: "by_day",
    title: "By day",
    sql: "SELECT day, COUNT(*) AS n FROM reviews GROUP BY day",
    shape: "line",
    columns: ["day", "n"],
    rowCount: 1,
    note: "capped",
  });
  expect(prev.prompts).toEqual(["a", "b"]);
});

test("a 400 body shows its message, anything else shows as-is", () => {
  expect(errorText(new Error('{"error":"Start over."}'))).toBe("Start over.");
  expect(errorText(new Error("Failed to fetch"))).toBe("Failed to fetch");
});
