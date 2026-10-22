import { Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatValue } from "./from-rows";
import { ChartTip, fillOf, Measured, type TipProps } from "./recharts-base";

// A donut for "what is this made of" when there are only a handful of parts.
// The ring shows the split, the hole carries the total, and the legend beside
// it prints every slice's count and share — so it reads without hovering, the
// tooltip is a convenience on top.
//
// Slices draw in the order the caller lists them, clockwise from 12 o'clock,
// and keep the caller's colours: an ordered scale (severity) stays in order,
// a categorical one stays in its fixed palette order. Zero-count slices have no
// arc but keep their legend row, so "0 blocking" still says something.

// Same shape as a MixBarItem, so `mixFromRows` output (with its palette fold)
// drops straight in.
export interface DonutSlice {
  key: string;
  label: string;
  count: number;
  // The colour as a Tailwind background utility ("bg-red-400"), the same
  // string a LegendDot takes; mapped to an SVG fill here.
  color: string;
}

const SIZE = 120;
// Below this a slice is a sliver you can't hover. Recharts widens it to this
// many degrees; the legend still prints the true count and share.
const MIN_ANGLE = 4;

/** "<1%" rather than "0%" for a slice that is there but tiny. */
function share(count: number, total: number): string {
  if (count === 0) return "0%";
  const pct = (count / total) * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function DonutChart({
  slices,
  unit,
}: {
  slices: DonutSlice[];
  /** What the values count, plural — "findings", "reviews". Shown under the total. */
  unit: string;
}) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  const drawn = slices.filter((x) => x.count > 0).map((x) => ({ ...x, fill: fillOf(x.color) }));
  const config: ChartConfig = Object.fromEntries(slices.map((x) => [x.key, { label: x.label }]));

  return (
    <div className="flex items-center gap-5 px-4 py-3.5">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <Measured className="h-full w-full">
          <ChartContainer config={config} className="aspect-square h-full w-full">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <ChartTooltip
                content={({ active, payload }: TipProps) => {
                  const s = payload?.[0]?.payload as DonutSlice | undefined;
                  return (
                    <ChartTip
                      active={active}
                      lines={s ? [s.label, `${formatValue(s.count)} ${unit} · ${share(s.count, total)}`] : []}
                    />
                  );
                }}
              />
              {/* The gap between slices is padding, not a stroke, so it shows
                  the panel itself whatever its background. A lone slice gets
                  none, or the ring would have a notch in it. */}
              <Pie
                data={drawn}
                dataKey="count"
                nameKey="label"
                innerRadius="68%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                paddingAngle={drawn.length > 1 ? 2 : 0}
                minAngle={drawn.length > 1 ? MIN_ANGLE : 0}
                cornerRadius={2}
                stroke="none"
                isAnimationActive={false}
              />
            </PieChart>
          </ChartContainer>
        </Measured>
        {/* Over the hole, not inside the SVG, so it lays out as text. Clicks
            pass through to the ring underneath. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold leading-none text-zinc-100 tabular-nums">
            {formatValue(total)}
          </span>
          <span className="mt-1 text-[0.7rem] text-zinc-500">{unit}</span>
        </div>
      </div>
      <ul className="min-w-0 max-w-64 flex-1 space-y-1.5 text-xs">
        {slices.map((x) => (
          <li
            key={x.key}
            className={`flex items-center gap-2 tabular-nums ${x.count === 0 ? "opacity-50" : ""}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${x.color}`} />
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={x.label}>
              {x.label}
            </span>
            <span className="text-zinc-200">{formatValue(x.count)}</span>
            <span className="w-9 text-right text-zinc-500">{share(x.count, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
