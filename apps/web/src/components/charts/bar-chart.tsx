import * as stylex from "@stylexjs/stylex";
import { color, radius, space } from "@/tokens.stylex";
import { scaleMax } from "./scale";

// Vertical bars, one per bucket. Both components below size their bars with a
// PERCENTAGE height, and a percentage only resolves against a definite parent
// height — so the container height must be a fixed height (10rem, 8rem), never
// a min-height. These charts usually sit in an `items-start` grid, where the
// row does not stretch its children: with a min-height alone every bar computed
// to 0px.
//
// The 2% floor keeps a zero bucket visible as a hairline rather than vanishing,
// which is what tells a reader "we looked, there was nothing" instead of "no
// data here".

const s = stylex.create({
  // The fixed height that makes the percentage bars resolve — see above.
  row: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.x4
  },
  rowTall: { height: space.x160 },
  rowShort: { height: space.x128 },
  bar: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    // rounded-t.
    borderStartStartRadius: radius.base,
    borderStartEndRadius: radius.base,
    // bg-primary/70 → hover:bg-ember-400. color-mix over the token var rather
    // than an `opacity` on the element, so the pulse/hover opacity of a parent
    // stays free.
    backgroundColor: {
      default: `color-mix(in oklab, ${color.primary} 70%, transparent)`,
      ":hover": color.ember400
    },
    transitionProperty: "background-color",
    transitionDuration: "150ms"
  },
  // Runtime-computed: the bar's share of the tallest value in the window.
  barHeight: (pct: string) => ({ height: pct }),
  stack: {
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    flexDirection: "column",
    justifyContent: "flex-end"
  },
  segment: { width: "100%" },
  // Runtime-computed: each slice takes `flex: value` of the bar's height —
  // i.e. flex-grow: value, the shrink/basis halves of the old `flex: N`.
  segmentFlex: (value: number) => ({ flexGrow: value, flexShrink: 1, flexBasis: "0%" })
});

// Corner rounding for the slice that ends up at the bottom of a stack. Exported
// because only the caller knows which slice that is once empty ones are
// dropped, and every caller must round it by the same amount.
const rounding = stylex.create({
  bottom: {
    borderEndStartRadius: radius.base,
    borderEndEndRadius: radius.base
  }
});

export const BAR_ROUNDED_BOTTOM: stylex.StyleXStyles = rounding.bottom;

export interface BarChartBar {
  key: string;
  value: number;
  // Native title= attribute — the only tooltip these charts use. Convention is
  // "a · b · c", e.g. "2026-08-02 · $0.1500 · 3 reviews".
  title?: string;
}

export function BarChart({
  bars,
  style
}: {
  bars: BarChartBar[];
  style?: stylex.StyleXStyles;
}) {
  const max = scaleMax(bars.map((b) => b.value));
  return (
    <div {...stylex.props(s.row, s.rowTall, style)}>
      {bars.map((b) => (
        <div
          key={b.key}
          title={b.title}
          {...stylex.props(s.bar, s.barHeight(`${Math.max(2, (b.value / max) * 100)}%`))}
        />
      ))}
    </div>
  );
}

export interface StackedBarSegment {
  key: string;
  value: number;
  // The colour for this slice, e.g. SEVERITY_COLORS.blocking — and any corner
  // rounding (BAR_ROUNDED_BOTTOM). Rounding lives with the caller because only
  // the caller knows which slice ends up at the bottom of the stack once empty
  // ones are dropped.
  style: stylex.StyleXStyles;
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
  style
}: {
  bars: StackedBar[];
  style?: stylex.StyleXStyles;
}) {
  const totalOf = (b: StackedBar) => b.segments.reduce((sum, seg) => sum + seg.value, 0);
  const max = scaleMax(bars.map(totalOf));
  return (
    <div {...stylex.props(s.row, s.rowShort, style)}>
      {bars.map((bar) => (
        <div
          key={bar.key}
          title={bar.title}
          {...stylex.props(s.stack, s.barHeight(`${Math.max(2, (totalOf(bar) / max) * 100)}%`))}
        >
          {bar.segments
            .filter((seg) => seg.value > 0)
            .map((seg) => (
              <div
                key={seg.key}
                {...stylex.props(s.segment, s.segmentFlex(seg.value), seg.style)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
