import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";

export interface MixBarItem {
  key: string;
  label: string;
  count: number;
  color: stylex.StyleXStyles;
}

const s = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.x12,
    paddingInline: space.x16,
    paddingBlock: space.x14
  },
  track: {
    display: "flex",
    height: space.x8,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: color.muted
  },
  // Runtime-computed: each slice's share of the total.
  slice: (pct: string) => ({ width: pct }),
  legend: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.x16,
    rowGap: space.x6,
    fontSize: text.xs, lineHeight: leading.xs,
    color: color.mutedForeground
  },
  entry: {
    display: "flex",
    alignItems: "center",
    gap: space.x6,
    fontVariantNumeric: "tabular-nums"
  },
  dot: {
    height: space.x8,
    width: space.x8,
    borderRadius: radius.full
  },
  count: { color: color.zinc600 }
});

// A 100% stacked horizontal bar with its own legend underneath. Good for "what
// is this made of" with a handful of categories; it says nothing about
// magnitude, so pair it with a count in the legend.
export function MixBar({ items }: { items: MixBarItem[] }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.track)}>
        {items.map((i) => (
          <div
            key={i.key}
            // Native title=, not a Radix tooltip: it works on the bare div, it
            // costs nothing, and the segments are too thin to hang a portal on.
            title={`${i.label}: ${i.count}`}
            {...stylex.props(s.slice(`${(i.count / total) * 100}%`), i.color)}
          />
        ))}
      </div>
      <div {...stylex.props(s.legend)}>
        {items.map((i) => (
          <span key={i.key} {...stylex.props(s.entry)}>
            <span {...stylex.props(s.dot, i.color)} />
            {i.label}
            <span {...stylex.props(s.count)}>{i.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
