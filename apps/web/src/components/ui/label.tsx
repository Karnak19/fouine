import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { text } from "@/tokens.stylex";

export interface LabelProps
  extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "className" | "style"> {
  style?: stylex.StyleXStyles;
}

const s = stylex.create({
  label: {
    fontSize: text.sm,
    fontWeight: 500,
    lineHeight: 1
  }
});

export function Label({ style, ...props }: LabelProps) {
  return <label {...props} {...stylex.props(s.label, style)} />;
}
