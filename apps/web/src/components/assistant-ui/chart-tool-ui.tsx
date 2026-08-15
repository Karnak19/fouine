"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { AlertTriangleIcon } from "lucide-react";
import {
  BarChart,
  LegendDot,
  LineChart,
  Panel,
  PanelEmpty,
  PanelSkeleton,
  StackedBarChart,
  TRIGGER_COLORS,
  scaleMax,
} from "@/components/charts";

// Mirrors `apps/server/src/chat/chart.ts`. Duplicated rather than imported
// because @fouine/shared is the only module both sides may share, and this
// shape belongs to the chat tool, not to the app's domain. `series` is OMITTED
// when unset, so it is optional here and never `undefined` on the wire.
type ChartType = "line" | "bar" | "stacked_bar";
type ChartSpec = { type: ChartType; title: string; x: string; y: string; series?: string };
type ChartRow = Record<string, string | number | null>;

export type RenderChartArgs = {
  sql?: string;
  type?: ChartType;
  title?: string;
  x?: string;
  y?: string;
  series?: string;
};

export type RenderChartResult =
  | { ok: true; spec: ChartSpec; rows: ChartRow[]; rowCount: number; ms: number; note?: string }
  | { ok: false; error: string };

/** SQLite hands back numbers for a measure; anything else is treated as absent. */
const num = (v: string | number | null | undefined) => (typeof v === "number" ? v : 0);

/** Whatever the x column holds becomes the category label. */
const label = (v: string | number | null | undefined) => (v == null ? "—" : String(v));

// Charts are read at a glance, so a measure is shown at the precision it needs
// and no more: counts stay integers, ratios and costs keep three decimals.
const formatValue = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 1 ? 3 : 2);

/** Distinct x values in the order the model's own ORDER BY produced them. */
function categoriesOf(rows: ChartRow[], x: string): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const key = label(r[x]);
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** One value per category, summed — a query may return several rows per x. */
function totalsByCategory(rows: ChartRow[], x: string, y: string): Map<string, number> {
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
// everything else is summed into a single honest "N others" painted with the last
// (zinc) entry — a fold, not a repeat.
//
// The fold's key carries a NUL so nothing a text column can hold will collide
// with it: a series genuinely called "other" keeps its own hue.
const OTHER = "\u0000other";
const seriesColor = (name: string, ranked: string[]) =>
  name === OTHER
    ? TRIGGER_COLORS[TRIGGER_COLORS.length - 1]!
    : TRIGGER_COLORS[ranked.indexOf(name)]!;

function rankSeries(
  rows: ChartRow[],
  series: string,
  y: string,
): { ranked: string[]; folded: number } {
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
const foldSeries = (name: string, ranked: string[]) => (ranked.includes(name) ? name : OTHER);

// Labels under the bars while there is room for them; past that they collide
// into a grey smear and the endpoints caption says more.
const LABELS_FIT = 12;

// No axes anywhere in this app. What replaces them: a label per category while
// they still fit, and past that the two endpoints with the peak between them.
function CategoryAxis({ cats, peak }: { cats: string[]; peak?: number }) {
  if (cats.length <= LABELS_FIT) {
    return (
      <div className="text-muted-foreground mt-2 flex gap-1 text-[0.7rem]">
        {cats.map((c) => (
          <span key={c} className="min-w-0 flex-1 truncate text-center" title={c}>
            {c}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="text-muted-foreground mt-2 flex justify-between gap-2 text-[0.7rem] tabular-nums">
      <span className="truncate">{cats[0]}</span>
      {peak !== undefined && <span className="shrink-0">{formatValue(peak)} peak</span>}
      <span className="truncate">{cats[cats.length - 1]}</span>
    </div>
  );
}

function ChartBody({ result }: { result: Extract<RenderChartResult, { ok: true }> }) {
  const { spec, rows } = result;
  const cats = categoriesOf(rows, spec.x);

  if (spec.type === "stacked_bar" && spec.series) {
    const series = spec.series;
    const { ranked, folded } = rankSeries(rows, series, spec.y);
    const seriesLabel = (s: string) => (s === OTHER ? `${folded} others` : s);
    // (category, series) → value, so a category missing a series simply has no
    // slice rather than a zero-height seam.
    const grid = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const cat = label(r[spec.x]);
      const bucket = grid.get(cat) ?? new Map<string, number>();
      const name = foldSeries(label(r[series]), ranked);
      bucket.set(name, (bucket.get(name) ?? 0) + num(r[spec.y]));
      grid.set(cat, bucket);
    }
    return (
      <>
        <StackedBarChart
          height="h-32"
          bars={cats.map((cat) => {
            const bucket = grid.get(cat)!;
            const present = ranked.filter((s) => (bucket.get(s) ?? 0) > 0);
            return {
              key: cat,
              title: [cat, ...present.map((s) => `${formatValue(bucket.get(s)!)} ${seriesLabel(s)}`)].join(" · "),
              segments: present.map((s, i) => ({
                key: s,
                value: bucket.get(s)!,
                className: `${seriesColor(s, ranked)} ${i === present.length - 1 ? "rounded-b" : ""}`,
              })),
            };
          })}
        />
        <CategoryAxis cats={cats} />
        {/* A legend is required the moment there are two series — the title can
            only name one thing. */}
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem]">
          {ranked.map((s) => (
            <LegendDot key={s} className={seriesColor(s, ranked)} label={seriesLabel(s)} />
          ))}
        </div>
      </>
    );
  }

  const totals = totalsByCategory(rows, spec.x, spec.y);
  const values = cats.map((c) => totals.get(c) ?? 0);
  const peak = scaleMax(values);
  const points = cats.map((c, i) => ({
    key: c,
    value: values[i]!,
    title: `${c} · ${formatValue(values[i]!)} ${spec.y}`,
  }));

  return (
    <>
      {spec.type === "line" ? <LineChart points={points} /> : <BarChart bars={points} />}
      <CategoryAxis cats={cats} peak={peak} />
    </>
  );
}

function ChartError({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex items-start gap-2 px-4 py-4 text-xs">
      <AlertTriangleIcon className="text-destructive mt-px size-3.5 shrink-0" />
      {/* Legible rather than hidden: the model reads this error too and usually
          retries, so the user should see what it is reacting to. */}
      <p className="min-w-0 break-words">{message}</p>
    </div>
  );
}

/**
 * The chart a `render_chart` call drew, inline in the thread.
 *
 * The model chooses the form and the columns; every colour is chosen here. Args
 * are never a source of colour — a model that could paint would eventually
 * paint two different things the same.
 *
 * Three states, always: still streaming, refused (`ok: false`, which is a normal
 * step the model recovers from), and drawn.
 */
export const ChartToolUI: ToolCallMessagePartComponent<RenderChartArgs, RenderChartResult> = ({
  args,
  result,
  status,
}) => {
  // The title streams in with the arguments, so the panel is named before it
  // has anything to draw rather than jumping from "Chart" to its real title.
  const title = args?.title || "Chart";

  return (
    // max-w and min-w-0 together: the chart fills the message column but never
    // widens it, which is what would push the thread sideways and break its
    // scrolling on a phone.
    <div className="my-2 w-full max-w-xl min-w-0">
      <Panel title={title}>
        {status.type !== "complete" || result === undefined ? (
          status.type === "incomplete" ? (
            <ChartError message="The chart was not drawn — the run stopped before the tool returned." />
          ) : (
            <PanelSkeleton rows={5} />
          )
        ) : !result.ok ? (
          <ChartError message={result.error} />
        ) : result.rows.length === 0 ? (
          <PanelEmpty label="The query returned nothing to plot." />
        ) : (
          <div className="flex flex-col px-4 pt-4 pb-3">
            <ChartBody result={result} />
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-2 text-[0.7rem] tabular-nums">
              <span>
                {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.ms}ms
              </span>
              {/* The truncation notice. A partial chart that does not say so is
                  a wrong chart. */}
              {result.note && <span className="text-destructive/90">{result.note}</span>}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
};
