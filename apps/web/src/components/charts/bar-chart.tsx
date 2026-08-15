import { scaleMax } from "./scale";

// Vertical bars, one per bucket. Both components below size their bars with a
// PERCENTAGE height, and a percentage only resolves against a definite parent
// height — so `height` must be a fixed height class (h-40, h-32), never a
// min-h-*. These charts usually sit in an `items-start` grid, where the row does
// not stretch its children: with a min-height alone every bar computed to 0px.
//
// The 2% floor keeps a zero bucket visible as a hairline rather than vanishing,
// which is what tells a reader "we looked, there was nothing" instead of "no
// data here".

export interface BarChartBar {
  key: string;
  value: number;
  // Native title= attribute — the only tooltip these charts use. Convention is
  // "a · b · c", e.g. "2026-08-02 · $0.1500 · 3 reviews".
  title?: string;
}

export function BarChart({
  bars,
  height = "h-40",
  barClassName = "rounded-t bg-primary/70 hover:bg-ember-400 transition-colors",
}: {
  bars: BarChartBar[];
  height?: string;
  barClassName?: string;
}) {
  const max = scaleMax(bars.map((b) => b.value));
  return (
    <div className={`flex items-end gap-1 ${height}`}>
      {bars.map((b) => (
        <div
          key={b.key}
          className={`flex-1 min-w-0 ${barClassName}`}
          style={{ height: `${Math.max(2, (b.value / max) * 100)}%` }}
          title={b.title}
        />
      ))}
    </div>
  );
}

export interface StackedBarSegment {
  key: string;
  value: number;
  // The full colour class for this slice, e.g. "bg-red-400" — and any corner
  // rounding. Rounding lives with the caller because only the caller knows
  // which slice ends up at the bottom of the stack once empty ones are dropped.
  className: string;
}

export interface StackedBar {
  key: string;
  segments: StackedBarSegment[];
  title?: string;
}

// The bar carries the bucket's total as its height; the segments inside split
// that height with `flex: value`, so the browser does the proportions and we
// never compute a percentage twice. Zero-value segments are dropped rather than
// rendered at 0 height, which would still show a 1px seam.
export function StackedBarChart({
  bars,
  height = "h-32",
}: {
  bars: StackedBar[];
  height?: string;
}) {
  const totalOf = (b: StackedBar) => b.segments.reduce((s, seg) => s + seg.value, 0);
  const max = scaleMax(bars.map(totalOf));
  return (
    <div className={`flex items-end gap-1 ${height}`}>
      {bars.map((bar) => (
        <div
          key={bar.key}
          className="flex flex-1 min-w-0 flex-col justify-end"
          style={{ height: `${Math.max(2, (totalOf(bar) / max) * 100)}%` }}
          title={bar.title}
        >
          {bar.segments
            .filter((seg) => seg.value > 0)
            .map((seg) => (
              <div key={seg.key} className={`w-full ${seg.className}`} style={{ flex: seg.value }} />
            ))}
        </div>
      ))}
    </div>
  );
}
