import * as stylex from "@stylexjs/stylex";
import { radius, space } from "@/tokens.stylex";

const s = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6
  },
  dot: {
    height: space.x8,
    width: space.x8,
    borderRadius: radius.full
  }
});

// There are no axes anywhere in these charts — a legend row and a caption row
// carry the meaning instead, which keeps a chart readable at 390px where axis
// labels would collide.
export function LegendDot({ style, label }: { style: stylex.StyleXStyles; label: string }) {
  return (
    <span {...stylex.props(s.root)}>
      <span {...stylex.props(s.dot, style)} />
      {label}
    </span>
  );
}
