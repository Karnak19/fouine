import * as stylex from "@stylexjs/stylex";
import { color, space } from "@/tokens.stylex";
import { shared } from "@/styles";
import { scaleMax } from "./scale";

// The one SVG in this codebase. Everything else here is divs with percentage
// sizes, and a line genuinely cannot be drawn that way: a polyline joins points
// that a stack of divs has no way to express.
//
// The viewBox is a fixed 0..100 square stretched by `preserveAspectRatio="none"`,
// so the maths stays in percentages like every other chart here and the browser
// does the scaling. The cost of non-uniform scaling is a stroke that would be
// squashed with it — `vector-effect="non-scaling-stroke"` is what keeps the line
// exactly 2px wide whatever the panel's aspect ratio.

const s = stylex.create({
  // Fixed height, like the bar charts: the hover columns below are positioned
  // against it.
  root: {
    position: "relative",
    height: space.x160
  },
  svg: {
    height: "100%",
    width: "100%",
    overflow: "visible"
  },
  line: { stroke: color.primary },
  dot: { fill: color.primary },
  hoverRow: {
    position: "absolute",
    inset: 0,
    display: "flex"
  }
});

export interface LinePoint {
  key: string;
  value: number;
  // Native title= attribute, same convention as the bar charts: "a · b · c".
  title?: string;
}

export function LineChart({
  points,
  style
}: {
  points: LinePoint[];
  style?: stylex.StyleXStyles;
}) {
  const max = scaleMax(points.map((p) => p.value));
  const last = points.length - 1;
  // A single point has no segment to draw, so it is placed mid-canvas and shown
  // as the dot below rather than as a zero-length line.
  const xOf = (i: number) => (last === 0 ? 50 : (i / last) * 100);
  // 2..98 rather than 0..100: at the extremes half the stroke would be clipped
  // by the viewBox edge, which reads as a line that thins out at the top.
  const yOf = (v: number) => 98 - (v / max) * 96;

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)} ${yOf(p.value)}`).join(" ");

  return (
    <div {...stylex.props(s.root, style)}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        {...stylex.props(s.svg)}
      >
        <path
          d={d}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          {...stylex.props(s.line)}
        />
        {points.length === 1 && (
          <circle
            cx={xOf(0)}
            cy={yOf(points[0]!.value)}
            r={2}
            vectorEffect="non-scaling-stroke"
            {...stylex.props(s.dot)}
          />
        )}
      </svg>
      {/* Hover targets are divs on top of the SVG, not <circle> elements: the
          non-uniform scale would turn a circle into an ellipse, and a column
          per point is an easier target than a 2px dot anyway. */}
      <div {...stylex.props(s.hoverRow)}>
        {points.map((p) => (
          <div key={p.key} title={p.title} {...stylex.props(shared.fill)} />
        ))}
      </div>
    </div>
  );
}
