import { test, expect } from "bun:test";
import {
  categoriesOf,
  formatValue,
  mixFromRows,
  pointsFromRows,
  rankSeries,
  seriesColor,
  stackedFromRows,
  totalsByCategory,
  type Row,
} from "@/components/charts/from-rows";
import { TRIGGER_COLORS } from "@/components/charts/colors";

// The mapping the chat thread's chart card and the /build registry both use.
// Pure on purpose — no DOM, no React — which is what lets the two callers share
// it instead of each growing its own slightly different idea of what "several
// rows per category" means.

const rows: Row[] = [
  { day: "mon", kind: "a", n: 1 },
  { day: "mon", kind: "b", n: 2 },
  { day: "tue", kind: "a", n: 4 },
];

test("categories keep the order the query produced, not sorted order", () => {
  expect(categoriesOf([{ x: "z" }, { x: "a" }, { x: "z" }], "x")).toEqual(["z", "a"]);
});

test("several rows per category are summed, not the last one wins", () => {
  expect(pointsFromRows(rows, "day", "n")).toEqual([
    { key: "mon", value: 3, title: "mon · 3 n" },
    { key: "tue", value: 4, title: "tue · 4 n" },
  ]);
  expect(totalsByCategory(rows, "day", "n").get("mon")).toBe(3);
});

test("a NULL category is labelled, not dropped, and a non-numeric measure is zero", () => {
  const points = pointsFromRows([{ day: null, n: "oops" }], "day", "n");
  expect(points).toEqual([{ key: "—", value: 0, title: "— · 0 n" }]);
});

test("a missing column reads as zero rather than NaN", () => {
  expect(pointsFromRows(rows, "day", "nope").every((p) => p.value === 0)).toBe(true);
});

test("counts stay integers, fractions keep the precision they need", () => {
  expect(formatValue(12)).toBe("12");
  expect(formatValue(12.3456)).toBe("12.35");
  expect(formatValue(0.12345)).toBe("0.123");
});

test("stacked bars grid on (category, series), and an absent series has no slice", () => {
  const { bars, ranked } = stackedFromRows(rows, "day", "n", "kind");
  expect(bars.map((b) => b.key)).toEqual(["mon", "tue"]);
  // Slices come in colour order (series ranked by total), not row order.
  expect(bars[0]!.segments.map((s) => [s.key, s.value])).toEqual([
    ["a", 1],
    ["b", 2],
  ]);
  // tue only has kind "a", so it draws ONE slice — not a zero-height seam.
  expect(bars[1]!.segments).toHaveLength(1);
  // Series are ranked by total, biggest first, which is what fixes the colours.
  expect(ranked).toEqual(["a", "b"]);
  // Bottom slice of each bar is the one that gets the rounding.
  expect(bars[0]!.segments.at(-1)!.className).toContain("rounded-b");
});

test("past four series the rest fold into one honest 'others' hue, never a repeat", () => {
  const many: Row[] = Array.from({ length: 8 }, (_, i) => ({ x: "one", s: `s${i}`, v: 8 - i }));
  const { ranked, folded } = rankSeries(many, "s", "v");
  expect(ranked).toHaveLength(TRIGGER_COLORS.length);
  expect(folded).toBe(8 - (TRIGGER_COLORS.length - 1));

  // Every visible series has a DIFFERENT colour: two live series sharing a hue
  // read as one category, which is the bug the fold exists to prevent.
  const colors = ranked.map((s) => seriesColor(s, ranked));
  expect(new Set(colors).size).toBe(colors.length);

  const { bars, legend } = stackedFromRows(many, "x", "v", "s");
  expect(bars[0]!.segments).toHaveLength(TRIGGER_COLORS.length);
  expect(legend(ranked.at(-1)!)).toBe(`${folded} others`);
});

test("a series genuinely called 'other' keeps its own hue", () => {
  const { ranked } = rankSeries([{ x: "a", s: "other", v: 1 }], "s", "v");
  expect(ranked).toEqual(["other"]);
  expect(seriesColor("other", ranked)).toBe(TRIGGER_COLORS[0]!);
});

test("mix bar slices are summed, ordered by size, folded, and never negative", () => {
  const items = mixFromRows(
    [
      { k: "nit", v: 3 },
      { k: "blocking", v: 6 },
      { k: "nit", v: 2 },
      { k: "gone", v: -1 },
    ],
    "k",
    "v",
  );
  expect(items.map((i) => [i.label, i.count])).toEqual([
    ["blocking", 6],
    ["nit", 5],
  ]);
  expect(items[0]!.color).toBe(TRIGGER_COLORS[0]!);
});

test("mix bar folds past the palette too", () => {
  const items = mixFromRows(
    Array.from({ length: 9 }, (_, i) => ({ k: `k${i}`, v: 9 - i })),
    "k",
    "v",
  );
  expect(items).toHaveLength(TRIGGER_COLORS.length);
  expect(items.at(-1)!.label).toBe(`${9 - (TRIGGER_COLORS.length - 1)} others`);
  expect(items.at(-1)!.color).toBe(TRIGGER_COLORS.at(-1)!);
});
