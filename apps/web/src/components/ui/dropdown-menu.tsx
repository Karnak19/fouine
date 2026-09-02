"use client";

import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { color, leading, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  content: {
    zIndex: 50,
    maxHeight: "var(--radix-dropdown-menu-content-available-height)",
    minWidth: space.x128,
    transformOrigin: "var(--radix-dropdown-menu-content-transform-origin)",
    overflowX: "hidden",
    overflowY: "auto",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    // Bare `border` in Tailwind leaves the colour at the preflight default
    // (`border: 0 solid` => currentColor). Preserved verbatim.
    borderColor: "currentColor",
    backgroundColor: color.popover,
    padding: space.x4,
    color: color.popoverForeground,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
  },
  subContent: {
    zIndex: 50,
    minWidth: space.x128,
    transformOrigin: "var(--radix-dropdown-menu-content-transform-origin)",
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "currentColor",
    backgroundColor: color.popover,
    padding: space.x4,
    color: color.popoverForeground,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"
  },

  // Shared by Item / CheckboxItem / RadioItem / SubTrigger.
  item: {
    position: "relative",
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: space.x8,
    borderRadius: radius.sm,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: leading.sm,
    outlineStyle: "none",
    userSelect: "none",
    backgroundColor: { default: null, ":focus": color.accent },
    color: { default: null, ":focus": color.accentForeground },
    pointerEvents: { default: null, "[data-disabled]": "none" },
    opacity: { default: null, "[data-disabled]": 0.5 }
  },
  // `data-[inset]:pl-8` — the attribute is set from the `inset` prop, but keep
  // it selector-driven so an externally set data-inset still indents.
  itemInline: {
    paddingLeft: { default: space.x8, "[data-inset]": space.x32 },
    paddingRight: space.x8
  },
  // Checkbox/radio items always reserve the indicator gutter on the left.
  itemIndicated: {
    paddingLeft: space.x32,
    paddingRight: space.x8
  },

  subTrigger: {
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: space.x8,
    borderRadius: radius.sm,
    paddingLeft: { default: space.x8, "[data-inset]": space.x32 },
    paddingRight: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: leading.sm,
    outlineStyle: "none",
    userSelect: "none",
    backgroundColor: {
      default: null,
      ":focus": color.accent,
      '[data-state="open"]': color.accent
    },
    color: {
      default: null,
      ":focus": color.accentForeground,
      '[data-state="open"]': color.accentForeground
    }
  },

  label: {
    paddingLeft: { default: space.x8, "[data-inset]": space.x32 },
    paddingRight: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: leading.sm,
    fontWeight: 500
  },
  separator: {
    // `-mx-1 my-1` — negative margins have no token, derived from space.x4.
    marginInline: `calc(${space.x4} * -1)`,
    marginBlock: space.x4,
    height: "1px",
    backgroundColor: color.border
  },
  shortcut: {
    marginLeft: "auto",
    fontSize: text.xs,
    lineHeight: leading.xs,
    letterSpacing: "0.1em",
    color: color.mutedForeground
  },

  indicatorSlot: {
    pointerEvents: "none",
    position: "absolute",
    left: space.x8,
    display: "flex",
    height: space.x14,
    width: space.x14,
    alignItems: "center",
    justifyContent: "center"
  },
  icon: {
    height: space.x16,
    width: space.x16,
    pointerEvents: "none",
    flexShrink: 0
  },
  radioDot: {
    height: space.x8,
    width: space.x8,
    fill: "currentColor",
    pointerEvents: "none",
    flexShrink: 0
  },
  subTriggerChevron: {
    marginLeft: "auto",
    height: space.x16,
    width: space.x16,
    pointerEvents: "none",
    flexShrink: 0
  }
});

const itemVariants = stylex.create({
  default: {},
  destructive: {
    // Overrides the shared `:focus` accent above: destructive items keep their
    // own colour on focus and tint the background instead — 10% light, 20% dark.
    color: { default: color.destructive, ":focus": color.destructive },
    backgroundColor: {
      default: null,
      ":focus": {
        default: `color-mix(in oklab, ${color.destructive} 10%, transparent)`,
        "@media (prefers-color-scheme: dark)": `color-mix(in oklab, ${color.destructive} 20%, transparent)`
      }
    }
  }
});

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  style,
  sideOffset = 4,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Content>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
        {...stylex.props(s.content, style)}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  style,
  inset,
  variant = "default",
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Item>, "className" | "style"> & {
  inset?: boolean;
  variant?: "default" | "destructive";
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      {...props}
      {...stylex.props(
        s.item,
        s.itemInline,
        itemVariants[variant],
        style,
      )}
    />
  );
}

function DropdownMenuCheckboxItem({
  style,
  children,
  checked,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      {...props}
      {...stylex.props(s.item, s.itemIndicated, style)}
    >
      <span {...stylex.props(s.indicatorSlot)}>
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon {...stylex.props(s.icon)} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  style,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      {...props}
      {...stylex.props(s.item, s.itemIndicated, style)}
    >
      <span {...stylex.props(s.indicatorSlot)}>
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon {...stylex.props(s.radioDot)} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  style,
  inset,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Label>, "className" | "style"> & {
  inset?: boolean;
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      {...props}
      {...stylex.props(s.label, style)}
    />
  );
}

function DropdownMenuSeparator({
  style,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Separator>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      {...props}
      {...stylex.props(s.separator, style)}
    />
  );
}

function DropdownMenuShortcut({
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <span data-slot="dropdown-menu-shortcut" {...props} {...stylex.props(s.shortcut, style)} />;
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  style,
  inset,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>, "className" | "style"> & {
  inset?: boolean;
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      {...props}
      {...stylex.props(s.subTrigger, style)}
    >
      {children}
      <ChevronRightIcon {...stylex.props(s.subTriggerChevron)} />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  style,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      {...props}
      {...stylex.props(s.subContent, style)}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
}
