"use client";

import type { ChartResult } from "@fouine/shared";
import {
  BarChart,
  LegendDot,
  LineChart,
  Panel,
  PanelEmpty,
  StackedBarChart,
  pointsFromRows,
  seriesColor,
  stackedFromRows,
} from "@/components/charts";

type ChartOk = Extract<ChartResult, { ok: true }>;

function ChartBody({ result }: { result: ChartOk }) {
  const { spec, rows } = result;

  if (spec.type === "stacked_bar" && spec.series) {
    const { bars, ranked, legend } = stackedFromRows(rows, spec.x, spec.y, spec.series);
    return (
      <>
        <StackedBarChart height="h-32" bars={bars} />
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

  // The charts draw their own axes and tooltip; the bar chart picks its
  // orientation from the labels and caps what it draws.
  const points = pointsFromRows(rows, spec.x, spec.y);
  return spec.type === "line" ? (
    <LineChart points={points} unit={spec.y} />
  ) : (
    <BarChart bars={points} unit={spec.y} />
  );
}

/**
 * One chart the `codemode` program drew, inline in the thread.
 *
 * The model chooses the form and the columns; every colour is chosen here. Args
 * are never a source of colour — a model that could paint would eventually
 * paint two different things the same. Only successful charts reach here: a
 * refused one (bad column, empty result) is a tool failure the program saw, and
 * shows in the code card's trace instead.
 */
export function ChartCard({ chart }: { chart: ChartOk }) {
  return (
    // max-w and min-w-0 together: the chart fills the message column but never
    // widens it, which is what would push the thread sideways and break its
    // scrolling on a phone.
    <div className="my-2 w-full max-w-xl min-w-0">
      <Panel title={chart.spec.title || "Chart"}>
        {chart.rows.length === 0 ? (
          <PanelEmpty label="The query returned nothing to plot." />
        ) : (
          <div className="flex flex-col px-4 pt-4 pb-3">
            <ChartBody result={chart} />
            <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-2 text-[0.7rem] tabular-nums">
              <span>
                {chart.rowCount} row{chart.rowCount === 1 ? "" : "s"} · {chart.ms}ms
              </span>
              {/* The truncation notice. A partial chart that does not say so is
                  a wrong chart. */}
              {chart.note && <span className="text-destructive/90">{chart.note}</span>}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
