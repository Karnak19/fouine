import { CartesianGrid, Line, LineChart as RLineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatValue } from "./from-rows";
import { ChartTip, Measured, TICK, Y_AXIS_WIDTH } from "./recharts-base";

export interface LinePoint {
  key: string;
  value: number;
  // Tooltip text, "a · b · c", same convention as the bars.
  title?: string;
}

/** Past this many points a dot per point is noise; the line carries it. */
export const DOTS_UP_TO = 30;

const config: ChartConfig = { value: { label: "value", color: "var(--color-primary)" } };

export function LineChart({
  points,
  height = "h-40",
  unit,
}: {
  points: LinePoint[];
  height?: string;
  /** What the value counts, for the tooltip when a point has no `title`. */
  unit?: string;
}) {
  const dots = points.length <= DOTS_UP_TO;
  const lines = (p: LinePoint) =>
    p.title ? p.title.split(" · ") : [p.key, unit ? `${formatValue(p.value)} ${unit}` : formatValue(p.value)];
  return (
    <Measured className={`w-full ${height}`}>
      <ChartContainer config={config} className="aspect-auto h-full w-full">
        <RLineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            cursor={{ stroke: "var(--color-border)" }}
            content={({ active, payload }) => (
              <ChartTip active={active} lines={payload?.[0] ? lines(payload[0].payload as LinePoint) : []} />
            )}
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={dots ? { r: 3, fill: "var(--color-value)", strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: "var(--color-ember-400)", strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </RLineChart>
      </ChartContainer>
    </Measured>
  );
}
