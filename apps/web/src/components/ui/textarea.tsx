import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, shadow, space, text } from "@/tokens.stylex";

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "style"> {
  style?: stylex.StyleXStyles;
}

const s = stylex.create({
  textarea: {
    display: "flex",
    minHeight: "60px",
    width: "100%",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc700,
    backgroundColor: color.zinc900,
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.sm, lineHeight: leading.sm,
    boxShadow: shadow.sm,
    // `focus-visible:ring-1` was a non-inset box-shadow; outline at offset 0
    // paints in the same place and keeps the shadow above intact.
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: "1px",
    outlineOffset: "0",
    outlineColor: color.zinc400,
    "::placeholder": { color: color.zinc500 }
  }
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ style, ...props }, ref) => (
    <textarea ref={ref} {...props} {...stylex.props(s.textarea, style)} />
  ),
);
Textarea.displayName = "Textarea";
