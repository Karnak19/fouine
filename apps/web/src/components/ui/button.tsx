import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> {
  variant?: "default" | "destructive" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  style?: stylex.StyleXStyles;
  // Semantic hooks ONLY — the `aui-*` names that the @assistant-ui registry
  // treats as a public styling contract, and vendored classes like `shimmer`.
  // Not for styling: pass `style` for that. Merged ahead of the compiled
  // StyleX class so StyleX still wins on any property it sets.
  className?: string;
}

const s = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x8,
    borderRadius: radius.md,
    fontSize: text.sm, lineHeight: leading.sm,
    fontWeight: 500,
    cursor: "pointer",
    transitionProperty: "color, background-color, transform",
    transitionDuration: "150ms",
    transform: { default: null, ":active": "scale(0.96)" },
    opacity: { default: null, ":disabled": 0.5 },
    pointerEvents: { default: null, ":disabled": "none" },
    borderWidth: 0,
    borderStyle: "solid"
  }
});

const variants = stylex.create({
  default: {
    backgroundColor: { default: color.ember500, ":hover": color.ember400 },
    color: color.zinc950
  },
  destructive: {
    backgroundColor: { default: color.dangerSurface, ":hover": color.dangerSurfaceHover },
    color: color.zinc100
  },
  outline: {
    borderWidth: "1px",
    borderColor: color.zinc700,
    backgroundColor: { default: "transparent", ":hover": color.zinc800 }
  },
  ghost: {
    backgroundColor: { default: "transparent", ":hover": color.zinc800 }
  }
});

const sizes = stylex.create({
  default: { height: space.x36, paddingInline: space.x16, paddingBlock: space.x8 },
  sm: { height: space.x32, paddingInline: space.x12, fontSize: text.sm, lineHeight: leading.sm },
  lg: { height: space.x40, paddingInline: space.x24 },
  icon: { height: space.x36, width: space.x36 }
});

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "default", style, className, ...props }, ref) => {
    const sx = stylex.props(s.base, variants[variant], sizes[size], style);
    return (
      // props spread FIRST: a stray style from a caller must not clobber the
      // compiled StyleX output. className is merged explicitly, not spread.
      <button
        {...props}
        ref={ref}
        {...sx}
        className={className ? `${className} ${sx.className ?? ""}`.trim() : sx.className}
      />
    );
  },
);
Button.displayName = "Button";
