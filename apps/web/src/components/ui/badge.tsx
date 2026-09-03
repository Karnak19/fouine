import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";

const s = stylex.create({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6,
    borderRadius: radius.full,
    paddingInline: space.x8,
    paddingBlock: space.x2,
    fontSize: text.xs, lineHeight: leading.xs,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    // `ring-1` was a non-inset box-shadow; outline at offset 0 paints in the
    // same place and follows the pill radius, without a shadow token.
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineOffset: "0"
  },
  pulse: {
    animationName: "fouine-pulse",
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite"
  }
});

const pills = stylex.create({
  pending: {
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 60%, transparent)`,
    color: color.zinc400,
    outlineColor: `color-mix(in oklab, ${color.zinc700} 50%, transparent)`
  },
  running: {
    backgroundColor: `color-mix(in oklab, ${color.ember950} 50%, transparent)`,
    color: color.ember300,
    outlineColor: `color-mix(in oklab, ${color.ember800} 40%, transparent)`
  },
  completed: {
    backgroundColor: `color-mix(in oklab, ${color.okSurfaceDeep} 40%, transparent)`,
    color: color.okText,
    outlineColor: `color-mix(in oklab, ${color.okSurface} 40%, transparent)`
  },
  failed: {
    backgroundColor: `color-mix(in oklab, ${color.dangerSurfaceDeep} 40%, transparent)`,
    color: color.dangerText,
    outlineColor: `color-mix(in oklab, ${color.dangerSurfaceHover} 40%, transparent)`
  },
  // Not an outcome — the push carried no diff change, so nothing ran. Muted on
  // purpose: it should read as "nothing to see", not as a result.
  skipped: {
    backgroundColor: `color-mix(in oklab, ${color.infoSurfaceDeep} 40%, transparent)`,
    color: color.infoText,
    outlineColor: `color-mix(in oklab, ${color.infoSurface} 40%, transparent)`
  }
});

const dots = stylex.create({
  pending: { backgroundColor: color.zinc500 },
  running: { backgroundColor: color.ember400 },
  completed: { backgroundColor: color.okDot },
  failed: { backgroundColor: color.dangerDot },
  // cat2 is byte-identical to Tailwind sky-400; there is no infoDot token.
  skipped: { backgroundColor: color.cat2 }
});

type Status = keyof typeof dots;

export function Badge({ status, style }: { status: string; style?: stylex.StyleXStyles }) {
  const key: Status = status in dots ? (status as Status) : "pending";
  return (
    <span {...stylex.props(s.pill, pills[key], style)}>
      <span {...stylex.props(shared.dot, dots[key], key === "running" && s.pulse)} />
      {status}
    </span>
  );
}
