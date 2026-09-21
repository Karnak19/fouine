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
  categoriesOf,
  formatValue,
  pointsFromRows,
  scaleMax,
  seriesColor,
  stackedFromRows,
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
    const { bars, ranked, legend } = stackedFromRows(rows, spec.x, spec.y, spec.series);
    return (
      <>
        <StackedBarChart height="h-32" bars={bars} />
        <CategoryAxis cats={cats} />
        {/* A legend is required the moment there are two series — the title can
            only name one thing. */}
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem]">
          {ranked.map((s) => (
            <LegendDot key={s} className={seriesColor(s, ranked)} label={legend(s)} />
          ))}
        </div>
      </>
    );
  }

  const points = pointsFromRows(rows, spec.x, spec.y);
  const peak = scaleMax(points.map((p) => p.value));

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
