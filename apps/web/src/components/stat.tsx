import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";

// Tailwind's `animate-pulse` for the loading skeleton. Redeclared because the
// @keyframes only exist while a className references the utility.
const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 }
});

const s = stylex.create({
  root: {
    paddingInline: space.x16,
    paddingBlock: space.x14
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: space.x6,
    fontSize: text.xxs,
    fontWeight: 500,
    textTransform: "uppercase",
    // tracking-wide. There is no letter-spacing group in tokens.stylex.ts.
    letterSpacing: "0.025em",
    color: color.zinc500
  },
  dot: {
    height: space.x6,
    width: space.x6,
    borderRadius: radius.full,
    backgroundColor: color.ember400,
    // fouine-pulse lives in global.css — referenced by name, not redefined, so
    // the two stay in sync.
    animationName: "fouine-pulse",
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite"
  },
  skeleton: {
    marginTop: space.x6,
    height: space.x28,
    width: space.x48,
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 70%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  value: {
    marginTop: space.x2,
    fontSize: text.xl2,
    lineHeight: leading.xl2,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: color.zinc100
  },
  valueAccent: { color: color.ember300 },
  sub: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    fontVariantNumeric: "tabular-nums"
  }
});

// One cell of a KPI strip: uppercase label over a big tabular-nums value.
// null value renders a skeleton; accent/pulse mark a live/running stat.
export function Stat({
  label,
  value,
  sub,
  accent,
  pulse: showPulse,
  style
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent?: boolean;
  pulse?: boolean;
  // A KPI strip draws its cell-to-cell hairlines here rather than on the grid
  // container: `divide-x`/`divide-y` are `& > * + *` rules and StyleX has no
  // child combinator, so the border has to live on the cell itself.
  style?: stylex.StyleXStyles;
}) {
  return (
    <div {...stylex.props(s.root, style)}>
      <div {...stylex.props(s.label)}>
        {showPulse && <span {...stylex.props(s.dot)} />}
        {label}
      </div>
      {value == null ? (
        <div {...stylex.props(s.skeleton)} />
      ) : (
        <div {...stylex.props(s.value, accent && s.valueAccent)}>{value}</div>
      )}
      {sub && <div {...stylex.props(s.sub)}>{sub}</div>}
    </div>
  );
}
