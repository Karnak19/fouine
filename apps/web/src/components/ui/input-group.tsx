"use client";

import * as React from "react";
import * as stylex from "@stylexjs/stylex";

import { color, leading, radius, space, text } from "@/tokens.stylex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SHADOW_XS = "0 1px 2px 0 rgb(0 0 0 / 0.05)";

const s = stylex.create({
  group: {
    position: "relative",
    display: "flex",
    width: "100%",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    minWidth: 0,
    outlineStyle: "none",
    transitionProperty: "color, box-shadow",

    // A textarea child, or a block-aligned addon, lets the group grow and
    // stack instead of staying one 36px row.
    height: {
      default: space.x36,
      ":has(> textarea)": "auto",
      ":has(> [data-align=block-start])": "auto",
      ":has(> [data-align=block-end])": "auto"
    },
    flexDirection: {
      default: "row",
      ":has(> [data-align=block-start])": "column",
      ":has(> [data-align=block-end])": "column"
    },

    // Focus state, then error state — error wins, matching the original
    // class order.
    borderColor: {
      default: color.input,
      ":has([data-slot=input-group-control]:focus-visible)": color.ring,
      ":has([data-slot][aria-invalid=true])": color.destructive
    },
    boxShadow: {
      default: SHADOW_XS,
      ":has([data-slot=input-group-control]:focus-visible)": `0 0 0 3px color-mix(in oklab, ${color.ring} 50%, transparent), ${SHADOW_XS}`,
      ":has([data-slot][aria-invalid=true])": {
        default: `0 0 0 3px color-mix(in oklab, ${color.destructive} 20%, transparent), ${SHADOW_XS}`,
        "@media (prefers-color-scheme: dark)": `0 0 0 3px color-mix(in oklab, ${color.destructive} 40%, transparent), ${SHADOW_XS}`
      }
    },
    backgroundColor: {
      default: null,
      "@media (prefers-color-scheme: dark)": `color-mix(in oklab, ${color.input} 30%, transparent)`
    }
  },

  addon: {
    display: "flex",
    height: "auto",
    cursor: "text",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm, lineHeight: leading.sm,
    fontWeight: 500,
    color: color.mutedForeground,
    userSelect: "none"
  },

  text: {
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    fontSize: text.sm, lineHeight: leading.sm,
    color: color.mutedForeground
  },

  control: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    boxShadow: { default: "none", ":focus-visible": "none" }
  },
  textareaControl: {
    resize: "none",
    paddingBlock: space.x12
  },

  button: {
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    fontSize: text.sm, lineHeight: leading.sm,
    boxShadow: "none"
  }
});

// `order-first` / `order-last` in Tailwind v4 are `order: calc(±infinity)`;
// ±9999 is the same thing for a handful of flex children.
const addonAligns = stylex.create({
  "inline-start": {
    order: -9999,
    paddingLeft: space.x12,
    marginLeft: { default: null, ":has(> button)": "-0.45rem", ":has(> kbd)": "-0.35rem" }
  },
  "inline-end": {
    order: 9999,
    paddingRight: space.x12,
    marginRight: { default: null, ":has(> button)": "-0.45rem", ":has(> kbd)": "-0.35rem" }
  },
  "block-start": {
    order: -9999,
    width: "100%",
    justifyContent: "flex-start",
    paddingInline: space.x12,
    paddingTop: space.x12
  },
  "block-end": {
    order: 9999,
    width: "100%",
    justifyContent: "flex-start",
    paddingInline: space.x12,
    paddingBottom: space.x12
  }
});

const buttonSizes = stylex.create({
  xs: {
    height: space.x24,
    gap: space.x4,
    paddingInline: space.x8
  },
  sm: {
    height: space.x32,
    gap: space.x6,
    borderRadius: radius.md,
    paddingInline: space.x10
  },
  "icon-xs": {
    height: space.x24,
    width: space.x24,
    padding: space.x0
  },
  "icon-sm": {
    height: space.x32,
    width: space.x32,
    padding: space.x0
  }
});

function InputGroup({
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <div data-slot="input-group" role="group" {...props} {...stylex.props(s.group, style)} />
  );
}

function InputGroupAddon({
  style,
  align = "inline-start",
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end";
  style?: stylex.StyleXStyles;
}) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
      {...stylex.props(s.addon, addonAligns[align], style)}
    />
  );
}

function InputGroupButton({
  style,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "style"> & {
  size?: "xs" | "sm" | "icon-xs" | "icon-sm";
  style?: stylex.StyleXStyles;
}) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      {...props}
      sx={[s.button, buttonSizes[size], style]}
    />
  );
}

function InputGroupText({
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <span {...props} {...stylex.props(s.text, style)} />;
}

function InputGroupInput({
  style,
  ...props
}: Omit<React.ComponentProps<"input">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <Input data-slot="input-group-control" {...props} style={[s.control, style]} />;
}

function InputGroupTextarea({
  style,
  ...props
}: Omit<React.ComponentProps<"textarea">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <Textarea
      data-slot="input-group-control"
      {...props}
      style={[s.control, s.textareaControl, style]}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea
};
