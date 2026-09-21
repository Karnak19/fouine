import * as React from "react";
import { defineRegistry } from "@json-render/react";
import { AlertTriangle, Info } from "lucide-react";
import {
  BarChart,
  CategoryAxis,
  LegendDot,
  LineChart,
  MixBar,
  Panel,
  PanelEmpty,
  PanelSkeleton,
  StackedBarChart,
  categoriesOf,
  mixFromRows,
  pointsFromRows,
  scaleMax,
  seriesColor,
  stackedFromRows,
} from "@/components/charts";
import { Stat } from "@/components/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildCatalog, MAX_TABLE_ROWS, type BuildDataset } from "@/build/catalog";

/**
 * How a catalog element becomes something on screen.
 *
 * The rule the whole registry turns on: a chart node carries a dataset KEY, and
 * the key is resolved HERE, against datasets that came straight off the wire
 * from `runStatsQuery`. A node's props are never a source of values, only of
 * names, so there is no path by which a number the model typed reaches a
 * pixel.
 *
 * Three states per data-backed node, always, and the difference between the
 * last two matters:
 *
 *  - the run is still going and this key has not arrived → PanelSkeleton. The
 *    layout streams faster than the data in the pathological case, and a chart
 *    that flashes "no data" and then fills in reads as a bug.
 *  - the run is over and the key never arrived → PanelEmpty. The model named a
 *    dataset it did not fetch; say so in place rather than crashing.
 *  - rows → the chart.
 */

interface DataContextValue {
  datasets: Record<string, BuildDataset>;
  /** True while the run is in flight, which is what makes "missing" mean "not yet". */
  streaming: boolean;
}

const DataContext = React.createContext<DataContextValue>({ datasets: {}, streaming: false });

export function BuildDataProvider({
  datasets,
  streaming,
  children,
}: DataContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ datasets, streaming }), [datasets, streaming]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/**
 * Resolve a dataset key into a panel body, or into whichever of the two
 * non-chart states applies. Every data-backed component goes through this, so
 * none of them can forget one of the three states.
 */
function WithDataset({
  data,
  title,
  render,
}: {
  data: string;
  title: string;
  render: (dataset: BuildDataset) => React.ReactNode;
}) {
  const { datasets, streaming } = React.useContext(DataContext);
  const dataset = datasets[data];
  return (
    <Panel title={title}>
      {!dataset ? (
        streaming ? (
          <PanelSkeleton rows={5} />
        ) : (
          <PanelEmpty label={`No dataset called "${data}" came back.`} />
        )
      ) : dataset.rows.length === 0 ? (
        <PanelEmpty label="The query returned nothing to plot." />
      ) : (
        <div className="flex flex-col px-4 pt-4 pb-3">
          {render(dataset)}
          <Caption dataset={dataset} />
        </div>
      )}
    </Panel>
  );
}

function Caption({ dataset }: { dataset: BuildDataset }) {
  return (
    <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-2 text-[0.7rem] tabular-nums">
      <span>
        {dataset.rowCount} row{dataset.rowCount === 1 ? "" : "s"} · {dataset.ms}ms
      </span>
      {/* A partial chart that does not say so is a wrong chart. */}
      {dataset.note && <span className="text-destructive/90">{dataset.note}</span>}
    </div>
  );
}

const GAP: Record<string, string> = { tight: "gap-3", normal: "gap-6", loose: "gap-10" };
// Written out rather than interpolated: Tailwind scans source text, and
// `md:grid-cols-${n}` is a class that never gets generated.
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/** How a StatTile's one number is written out. */
function formatUnit(value: unknown, unit: string): string {
  if (typeof value !== "number") return value == null ? "—" : String(value);
  switch (unit) {
    case "currency":
      return `$${value.toFixed(4)}`;
    case "percent":
      // A ratio, always: the catalog tells the model to produce 0..1, so there
      // is nothing to guess. Guessing was wrong under 1% — 0.5 meaning half a
      // percent rendered as 50%.
      return `${(value * 100).toFixed(1)}%`;
    case "seconds":
      return value < 60 ? `${Math.round(value)}s` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
}

export const { registry } = defineRegistry(buildCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div className={`flex min-w-0 flex-col ${GAP[props.gap] ?? GAP.normal}`}>{children}</div>
    ),

    Grid: ({ props, children }) => (
      // min-w-0 on every grid wrapper, same reason as in panel.tsx: without it
      // a wide table grows the column instead of scrolling inside its own box.
      <div className={`grid min-w-0 items-start gap-4 ${COLUMNS[props.columns] ?? COLUMNS[2]}`}>{children}</div>
    ),

    Text: ({ props }) =>
      props.variant === "heading" ? (
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">{props.content}</h2>
      ) : props.variant === "subheading" ? (
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{props.content}</h3>
      ) : (
        <p className="text-sm text-zinc-400">{props.content}</p>
      ),

    Note: ({ props }) => (
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
          props.tone === "warning"
            ? "border-destructive/40 bg-destructive/5 text-zinc-300"
            : "border-border bg-card/40 text-muted-foreground"
        }`}
      >
        {props.tone === "warning" ? (
          <AlertTriangle className="text-destructive mt-px size-3.5 shrink-0" />
        ) : (
          <Info className="mt-px size-3.5 shrink-0 text-zinc-500" />
        )}
        <p className="min-w-0 break-words">{props.text}</p>
      </div>
    ),

    StatTile: ({ props }) => {
      const { datasets, streaming } = React.useContext(DataContext);
      const dataset = datasets[props.data];
      const cell = dataset?.rows[0]?.[props.column];
      return (
        <div className="rounded-lg border border-border bg-card/40">
          <Stat
            label={props.label}
            // null renders the skeleton the component already owns; once the
            // run is over, a key that never arrived reads as an em dash rather
            // than a number nobody can trace.
            value={!dataset ? (streaming ? null : "—") : formatUnit(cell, props.unit)}
            sub={dataset?.note ? "partial" : undefined}
          />
        </div>
      );
    },

    BarChart: ({ props }) => (
      <WithDataset
        data={props.data}
        title={props.title}
        render={(d) => {
          const points = pointsFromRows(d.rows, props.x, props.y);
          return (
            <>
              <BarChart bars={points} />
              <CategoryAxis cats={points.map((p) => p.key)} peak={scaleMax(points.map((p) => p.value))} />
            </>
          );
        }}
      />
    ),

    LineChart: ({ props }) => (
      <WithDataset
        data={props.data}
        title={props.title}
        render={(d) => {
          const points = pointsFromRows(d.rows, props.x, props.y);
          return (
            <>
              <LineChart points={points} />
              <CategoryAxis cats={points.map((p) => p.key)} peak={scaleMax(points.map((p) => p.value))} />
            </>
          );
        }}
      />
    ),

    StackedBarChart: ({ props }) => (
      <WithDataset
        data={props.data}
        title={props.title}
        render={(d) => {
          const { bars, ranked, legend } = stackedFromRows(d.rows, props.x, props.y, props.series);
          return (
            <>
              <StackedBarChart height="h-32" bars={bars} />
              <CategoryAxis cats={categoriesOf(d.rows, props.x)} />
              {/* A legend is required the moment there are two series. */}
              <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem]">
                {ranked.map((s) => (
                  <LegendDot key={s} className={seriesColor(s, ranked)} label={legend(s)} />
                ))}
              </div>
            </>
          );
        }}
      />
    ),

    MixBar: ({ props }) => (
      <WithDataset
        data={props.data}
        title={props.title}
        // MixBar brings its own padding and legend, so it cancels the padded
        // body the other charts use — same trick as Table below.
        render={(d) => (
          <div className="-mx-4 -mt-4">
            <MixBar items={mixFromRows(d.rows, props.label, props.value)} />
          </div>
        )}
      />
    ),

    Table: ({ props }) => (
      <WithDataset
        data={props.data}
        title={props.title}
        render={(d) => {
          // Column names the model asked for, minus any that are not actually
          // in the result — a wrong name must not produce a column of blanks.
          const cols = (props.columns ?? []).filter((c) => d.columns.includes(c));
          const shown = cols.length > 0 ? cols : d.columns;
          const rows = d.rows.slice(0, MAX_TABLE_ROWS);
          return (
            // Its own overflow box, or a wide table pushes the whole page
            // sideways on a phone.
            <div className="-mx-4 -mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {shown.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      {shown.map((c) => (
                        <TableCell key={c} className="tabular-nums">
                          {r[c] == null ? "—" : String(r[c])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        }}
      />
    ),
  },
});
