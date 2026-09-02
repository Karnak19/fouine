import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { color, radius, space, text, tracking } from "@/tokens.stylex";

type DivProps = Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
};

type HeadingProps = Omit<React.HTMLAttributes<HTMLHeadingElement>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
};

const s = stylex.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 50%, transparent)`,
    padding: space.x24
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.x6,
    paddingBottom: space.x16
  },
  title: {
    fontSize: text.lg,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: tracking.tight
  }
});

export function Card({ style, ...props }: DivProps) {
  return <div {...props} {...stylex.props(s.card, style)} />;
}

export function CardHeader({ style, ...props }: DivProps) {
  return <div {...props} {...stylex.props(s.header, style)} />;
}

export function CardTitle({ style, ...props }: HeadingProps) {
  return <h3 {...props} {...stylex.props(s.title, style)} />;
}

export function CardContent({ style, ...props }: DivProps) {
  return <div {...props} {...stylex.props(style)} />;
}
