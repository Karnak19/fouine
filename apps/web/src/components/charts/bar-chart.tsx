import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { barLayout, capBars, formatValue, type BarLayout } from "./from-rows";
import { ChartTip, fillOf, Measured, TICK, Y_AXIS_WIDTH } from "./recharts-base";

// Bars on Recharts. Two forms, decided from the labels by `barLayout` unless
// the caller says otherwise: vertical for timelines and short buckets, where
// the shape is the point; horizontal for a ranking of named things, where the
// name must read in full and each bar prints its value.
//
// `height` only applies to the vertical form — Recharts fills its parent, so
// it must be a definite height class (h-40, h-32), never a min-h. These charts
// sit in `items-start` grids that do not stretch their children. The
// horizontal form sizes itself from the number of rows instead.

export interface BarChartBar {
  key: string;
  value: number;
  // Tooltip text, "a · b · c" — e.g. "2026-08-02 · $0.1500 · 3 reviews". When
  // absent the tooltip shows the key and the formatted value.
  title?: string;
}

const tipLines = (b: { key: string; value: number; title?: string }, unit?: string) =>
  b.title ? b.title.split(" · ") : [b.key, unit ? `${formatValue(b.value)} ${unit}` : formatValue(b.value)];

const ROW_HEIGHT = 24;
const LABEL_MAX_CHARS = 26;
const shortLabel = (s: string) => (s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s);

const config: ChartConfig = { value: { label: "value", color: "var(--color-primary)" } };

export function BarChart({
  bars,
  height = "h-40",
  layout,
  unit,
}: {
  bars: BarChartBar[];
  height?: string;
  /** Force a form; by default `barLayout` reads it off the labels. */
  layout?: BarLayout;
  /** What the value counts, for the tooltip when a bar has no `title`. */
  unit?: string;
}) {
  const form = layout ?? barLayout(bars.map((b) => b.key));
  const { shown, hidden } = capBars(bars, form);
  const note = hidden > 0 && (
    <p className="text-muted-foreground mt-1 text-[0.7rem] tabular-nums">
      {hidden} more not drawn
    </p>
  );

  if (form === "horizontal") {
    const longest = Math.max(...shown.map((b) => shortLabel(b.key).length), 4);
    const labelWidth = Math.min(160, longest * 6.4 + 8);
    return (
      <div>
        <Measured className="w-full" style={{ height: shown.length * ROW_HEIGHT + 8 }}>
          <ChartContainer config={config} className="aspect-auto h-full w-full">
            <RBarChart data={shown} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 0 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" hide domain={[0, "auto"]} />
              <YAxis
                type="category"
                dataKey="key"
                width={labelWidth}
                interval={0}
                tickLine={false}
                axisLine={false}
                tick={TICK}
                tickFormatter={shortLabel}
              />
              <ChartTooltip
                cursor={{ fill: "var(--color-muted)", fillOpacity: 0.4 }}
                content={({ active, payload }) => (
                  <ChartTip
                    active={active}
                    lines={payload?.[0] ? tipLines(payload[0].payload as BarChartBar, unit) : []}
                  />
                )}
              />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 3, 3, 0]}
                barSize={ROW_HEIGHT - 8}
                activeBar={{ fill: "var(--color-ember-400)" }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={6}
                  fontSize={10}
                  className="fill-muted-foreground tabular-nums"
                  formatter={(v: unknown) => formatValue(Number(v))}
                />
              </Bar>
            </RBarChart>
          </ChartContainer>
        </Measured>
        {note}
      </div>
    );
  }

  return (
    <div>
      <Measured className={`w-full ${height}`}>
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <RBarChart data={shown} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              tick={TICK}
            />
            <YAxis
              width={Y_AXIS_WIDTH}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              tick={TICK}
              domain={[0, "auto"]}
              tickFormatter={(v: number) => formatValue(v)}
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.4 }}
              content={({ active, payload }) => (
                <ChartTip
                  active={active}
                  lines={payload?.[0] ? tipLines(payload[0].payload as BarChartBar, unit) : []}
                />
              )}
            />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={[3, 3, 0, 0]}
              activeBar={{ fill: "var(--color-ember-400)" }}
              isAnimationActive={false}
            />
          </RBarChart>
        </ChartContainer>
      </Measured>
      {note}
    </div>
  );
}

export interface StackedBarSegment {
  key: string;
  value: number;
  // The colour as a Tailwind background utility, e.g. "bg-red-400" — the same
  // string a LegendDot takes, mapped to an SVG fill here. Any other class in
  // the string (the old "rounded-b") is ignored.
  className: string;
}

export interface StackedBar {
  key: string;
  segments: StackedBarSegment[];
  title?: string;
}

// The order series stack in is the order the caller lists segments: first on
// top, last at the bottom, which is how the legends read. A bar missing a
// series simply has no slice. Series are keyed s0, s1… inside the chart because
// ChartConfig keys become CSS variable names and a series key is arbitrary
// text (the "others" fold even carries a NUL).
function seriesOrder(bars: StackedBar[]): string[] {
  const order: string[] = [];
  for (const bar of bars) {
    bar.segments.forEach((seg, i) => {
      if (order.includes(seg.key)) return;
      const prev = i > 0 ? order.indexOf(bar.segments[i - 1]!.key) : -1;
      order.splice(prev + 1, 0, seg.key);
    });
  }
  return order;
}

export function StackedBarChart({
  bars,
  height = "h-32",
}: {
  bars: StackedBar[];
  height?: string;
}) {
  const { shown, hidden } = capBars(
    bars.map((b) => ({ ...b, value: b.segments.reduce((s, seg) => s + seg.value, 0) })),
    "vertical",
  );
  const series = seriesOrder(shown);
  const id = (s: string) => `s${series.indexOf(s)}`;
  const config: ChartConfig = {};
  for (const bar of shown) {
    for (const seg of bar.segments) {
      if (!config[id(seg.key)]) config[id(seg.key)] = { label: seg.key, color: fillOf(seg.className) };
    }
  }
  const data = shown.map((bar) => {
    const row: Record<string, string | number | undefined> = { key: bar.key, title: bar.title };
    for (const seg of bar.segments) if (seg.value > 0) row[id(seg.key)] = seg.value;
    return row;
  });
  const lines = (bar: StackedBar) =>
    bar.title
      ? bar.title.split(" · ")
      : [bar.key, ...bar.segments.filter((s) => s.value > 0).map((s) => `${formatValue(s.value)} ${s.key}`)];

  return (
    <div>
      <Measured className={`w-full ${height}`}>
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <RBarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              tick={TICK}
            />
            <YAxis
              width={Y_AXIS_WIDTH}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              allowDecimals={false}
              tick={TICK}
              domain={[0, "auto"]}
              tickFormatter={(v: number) => formatValue(v)}
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.4 }}
              content={({ active, payload }) => {
                const bar = payload?.[0] ? shown.find((b) => b.key === (payload[0]!.payload as StackedBar).key) : undefined;
                return <ChartTip active={active} lines={bar ? lines(bar) : []} />;
              }}
            />
            {/* Recharts stacks the first <Bar> at the bottom, so the series go
                in reversed: the caller's last segment is the base. */}
            {[...series].reverse().map((s) => (
              <Bar key={s} dataKey={id(s)} stackId="stack" fill={`var(--color-${id(s)})`} isAnimationActive={false} />
            ))}
          </RBarChart>
        </ChartContainer>
      </Measured>
      {hidden > 0 && (
        <p className="text-muted-foreground mt-1 text-[0.7rem] tabular-nums">{hidden} more not drawn</p>
      )}
    </div>
  );
}
