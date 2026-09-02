import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, shadow, space, text } from "@/tokens.stylex";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "style"> {
  style?: stylex.StyleXStyles;
}

const s = stylex.create({
  input: {
    display: "flex",
    height: space.x36,
    width: "100%",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc700,
    backgroundColor: color.zinc900,
    paddingInline: space.x12,
    paddingBlock: space.x4,
    fontSize: text.sm, lineHeight: leading.sm,
    boxShadow: shadow.sm,
    transitionProperty: "color, background-color, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    // `focus-visible:ring-1` was a non-inset box-shadow; outline at offset 0
    // paints in the same place and keeps the shadow above intact.
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: "1px",
    outlineOffset: "0",
    outlineColor: color.zinc400,
    "::placeholder": { color: color.zinc500 }
  }
});

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ style, ...props }, ref) => (
  <input ref={ref} {...props} {...stylex.props(s.input, style)} />
));
Input.displayName = "Input";
