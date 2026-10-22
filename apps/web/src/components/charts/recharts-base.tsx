import * as React from "react";
import type { TooltipContentProps } from "recharts";
import { PanelSkeleton } from "./panel";

// The pieces the three Recharts charts share: turning the palette's Tailwind
// class names into SVG fills, a width guard, and one tooltip.

/**
 * The palette (colors.ts) and every stats panel name a colour as a Tailwind
 * background utility — `bg-ember-400`, `bg-emerald-500/80`. That is what a
 * LegendDot needs; an SVG `fill` needs the CSS variable behind it. Tailwind v4
 * exposes every theme colour as `--color-<name>`, and it emits the variable
 * because the utility itself appears in source, so the two can never drift.
 * `/80` becomes a color-mix, the same thing the utility compiles to.
 */
export function fillOf(className: string): string {
  const token = className.split(/\s+/).find((c) => c.startsWith("bg-")) ?? className;
  const m = /^bg-([a-z]+-\d{2,3}|[a-z-]+)(?:\/(\d{1,3}))?$/.exec(token);
  if (!m) return "var(--color-primary)";
  const base = `var(--color-${m[1]})`;
  return m[2] ? `color-mix(in oklab, ${base} ${m[2]}%, transparent)` : base;
}

/**
 * Recharts measures its parent at mount. Before layout (and under prerender,
 * where there is no layout at all) that width is 0, and a chart drawn into 0px
 * is a stack of warnings. So the chart waits for a real width and shows the
 * skeleton until then — the box keeps its height either way, so nothing jumps.
 */
export function Measured({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setReady(el.getBoundingClientRect().width > 0);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={style}>
      {ready ? children : <PanelSkeleton rows={3} />}
    </div>
  );
}

/**
 * One tooltip for every chart. The first line is the category, the rest are
 * "value unit" pairs — the same "a · b · c" convention the old title= strings
 * used, which is why a caller's `title` still drives it when present.
 */
export function ChartTip({
  active,
  lines,
}: Pick<TooltipContentProps<number, string>, "active"> & { lines: string[] }) {
  if (!active || lines.length === 0) return null;
  const [head, ...rest] = lines;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium text-foreground">{head}</div>
      {rest.map((l, i) => (
        <div key={i} className="text-muted-foreground tabular-nums">
          {l}
        </div>
      ))}
    </div>
  );
}

// Axis and grid settings shared by the vertical charts, so a bar chart and a
// line chart of the same data line up.
export const TICK = { fontSize: 10 } as const;
export const Y_AXIS_WIDTH = 36;
