import * as stylex from "@stylexjs/stylex";
import { space } from "@/tokens.stylex";
import { shared } from "@/styles";

const s = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6
  }
});

// There are no axes anywhere in these charts — a legend row and a caption row
// carry the meaning instead, which keeps a chart readable at 390px where axis
// labels would collide.
export function LegendDot({ style, label }: { style: stylex.StyleXStyles; label: string }) {
  return (
    <span {...stylex.props(s.root)}>
      <span {...stylex.props(shared.dotLarge, style)} />
      {label}
    </span>
  );
}
