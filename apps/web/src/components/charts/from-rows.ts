import { TRIGGER_COLORS } from "./colors";
import type { BarChartBar, StackedBar } from "./bar-chart";
import type { LinePoint } from "./line-chart";
import type { MixBarItem } from "./mix-bar";

// Rows plus a choice of columns become chart props. Nothing here renders; it is
// all pure, which is why it can be tested without a DOM and why both callers
// can share it.
//
// Two callers: the chat thread's `render_chart` tool card, and the /build
// registry. They arrive at rows by different routes — one tool result, one
// keyed dataset — but the mapping from (rows, x, y, series) to what a chart
// component wants is identical, and a second copy of it would be a second
// place for "several rows per category" to be handled slightly differently.

export type Row = Record<string, string | number | null>;

/** SQLite hands back numbers for a measure; anything else is treated as absent. */
export const num = (v: string | number | null | undefined) => (typeof v === "number" ? v : 0);

/** Whatever the x column holds becomes the category label. */
export const label = (v: string | number | null | undefined) => (v == null ? "—" : String(v));

// Charts are read at a glance, so a measure is shown at the precision it needs
// and no more: counts stay integers, ratios and costs keep three decimals.
export const formatValue = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 3 : 2);

/** Distinct x values in the order the model's own ORDER BY produced them. */
export function categoriesOf(rows: Row[], x: string): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const key = label(r[x]);
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** One value per category, summed — a query may return several rows per x. */
export function totalsByCategory(rows: Row[], x: string, y: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = label(r[x]);
    out.set(key, (out.get(key) ?? 0) + num(r[y]));
  }
  return out;
}

// The palette has five entries and its own rule: hues are assigned in a FIXED
// order and never cycled, because the same colour on two live series makes them
// read as one category. So the four largest series keep a hue each and
// everything else is summed into a single honest "N others" painted with the
// last (zinc) entry — a fold, not a repeat.
//
// The fold's key carries a NUL so nothing a text column can hold will collide
// with it: a series genuinely called "other" keeps its own hue.
export const OTHER = "\u0000other";

export const seriesColor = (name: string, ranked: string[]) =>
  name === OTHER
    ? TRIGGER_COLORS[TRIGGER_COLORS.length - 1]!
    : (TRIGGER_COLORS[ranked.indexOf(name)] ?? TRIGGER_COLORS[TRIGGER_COLORS.length - 1]!);

export function rankSeries(rows: Row[], series: string, y: string): { ranked: string[]; folded: number } {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = label(r[series]);
    totals.set(key, (totals.get(key) ?? 0) + num(r[y]));
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = TRIGGER_COLORS.length - 1;
  if (ordered.length <= keep) return { ranked: ordered, folded: 0 };
  return { ranked: [...ordered.slice(0, keep), OTHER], folded: ordered.length - keep };
}

/** Bucket a row's series value into its own hue or into the "Other" fold. */
export const foldSeries = (name: string, ranked: string[]) => (ranked.includes(name) ? name : OTHER);

/** Bars or line points: one entry per category, with the "a · b · c" title. */
export function pointsFromRows(rows: Row[], x: string, y: string): (BarChartBar & LinePoint)[] {
  const totals = totalsByCategory(rows, x, y);
  return categoriesOf(rows, x).map((c) => {
    const value = totals.get(c) ?? 0;
    return { key: c, value, title: `${c} · ${formatValue(value)} ${y}` };
  });
}

export interface StackedResult {
  bars: StackedBar[];
  /** The series in colour order, for the legend. */
  ranked: string[];
  /** How many series were folded into the last entry. 0 if none. */
  folded: number;
  /** Legend text for a series key, which handles the fold. */
  legend: (s: string) => string;
}

/**
 * Stacked bars: (category, series) → value, so a category missing a series
 * simply has no slice rather than a zero-height seam.
 */
export function stackedFromRows(rows: Row[], x: string, y: string, series: string): StackedResult {
  const cats = categoriesOf(rows, x);
  const { ranked, folded } = rankSeries(rows, series, y);
  const legend = (s: string) => (s === OTHER ? `${folded} others` : s);

  const grid = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const cat = label(r[x]);
    const bucket = grid.get(cat) ?? new Map<string, number>();
    const name = foldSeries(label(r[series]), ranked);
    bucket.set(name, (bucket.get(name) ?? 0) + num(r[y]));
    grid.set(cat, bucket);
  }

  const bars = cats.map((cat) => {
    const bucket = grid.get(cat)!;
    const present = ranked.filter((s) => (bucket.get(s) ?? 0) > 0);
    return {
      key: cat,
      title: [cat, ...present.map((s) => `${formatValue(bucket.get(s)!)} ${legend(s)}`)].join(" · "),
      segments: present.map((s, i) => ({
        key: s,
        value: bucket.get(s)!,
        className: `${seriesColor(s, ranked)} ${i === present.length - 1 ? "rounded-b" : ""}`,
      })),
    };
  });

  return { bars, ranked, folded, legend };
}

/**
 * MixBar items: one slice per label, summed, in the palette's fixed order with
 * the same fold as the stacked bars. A MixBar shows proportion only, so a
 * negative slice would draw a negative width — those are dropped.
 */
export function mixFromRows(rows: Row[], labelCol: string, valueCol: string): MixBarItem[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = label(r[labelCol]);
    totals.set(key, (totals.get(key) ?? 0) + num(r[valueCol]));
  }
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const keep = TRIGGER_COLORS.length - 1;
  const head = ordered.slice(0, keep);
  const tail = ordered.slice(keep);
  const items = head.map(([key, count], i) => ({
    key,
    label: key,
    count,
    color: TRIGGER_COLORS[i]!,
  }));
  if (tail.length > 0) {
    items.push({
      key: OTHER,
      label: `${tail.length} others`,
      count: tail.reduce((s, [, v]) => s + v, 0),
      color: TRIGGER_COLORS[TRIGGER_COLORS.length - 1]!,
    });
  }
  return items.filter((i) => i.count > 0);
}
