import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { Popover as PopoverPrimitive } from "radix-ui";

import { color, leading, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  content: {
    zIndex: 50,
    // 18rem — `w-72`, off the base-4 token scale.
    width: "18rem",
    transformOrigin: "var(--radix-popover-content-transform-origin)",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    // Tailwind's bare `border` leaves the colour at the preflight default
    // (`border: 0 solid` => currentColor). Kept as-is so the migration is a
    // pure restyle; see the report note about this looking unintentional.
    borderColor: "currentColor",
    backgroundColor: color.popover,
    padding: space.x16,
    color: color.popoverForeground,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    outlineStyle: "none"
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.x4,
    fontSize: text.sm,
    lineHeight: leading.sm
  },
  title: {
    fontWeight: 500
  },
  description: {
    color: color.mutedForeground
  }
});

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  style,
  align = "center",
  sideOffset = 4,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        {...props}
        {...stylex.props(s.content, style)}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <div data-slot="popover-header" {...props} {...stylex.props(s.header, style)} />;
}

function PopoverTitle({
  style,
  ...props
}: Omit<React.ComponentProps<"h2">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <div data-slot="popover-title" {...props} {...stylex.props(s.title, style)} />;
}

function PopoverDescription({
  style,
  ...props
}: Omit<React.ComponentProps<"p">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <p data-slot="popover-description" {...props} {...stylex.props(s.description, style)} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription
};
