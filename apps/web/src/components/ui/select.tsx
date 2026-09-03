"use client";

import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { color, leading, radius, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";

const RING = `0 0 0 3px color-mix(in oklab, ${color.ring} 50%, transparent)`;
const RING_INVALID = `0 0 0 3px color-mix(in oklab, ${color.destructive} 20%, transparent)`;
const RING_INVALID_DARK = `0 0 0 3px color-mix(in oklab, ${color.destructive} 40%, transparent)`;
const SHADOW_XS = "0 1px 2px 0 rgb(0 0 0 / 0.05)";

const s = stylex.create({
  trigger: {
    display: "flex",
    width: "fit-content",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.x8,
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: color.input,
      ":focus-visible": color.ring,
      '[aria-invalid="true"]': color.destructive
    },
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.sm,
    lineHeight: leading.sm,
    whiteSpace: "nowrap",
    transitionProperty: "color, box-shadow",
    outlineStyle: "none",
    // `shadow-xs` composed with the focus/invalid ring, which Tailwind stacks
    // into the same box-shadow.
    boxShadow: {
      default: SHADOW_XS,
      '[aria-invalid="true"]': {
        default: `${RING_INVALID}, ${SHADOW_XS}`,
        "@media (prefers-color-scheme: dark)": `${RING_INVALID_DARK}, ${SHADOW_XS}`
      },
      ":focus-visible": `${RING}, ${SHADOW_XS}`
    },
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
    color: { default: null, "[data-placeholder]": color.mutedForeground },
    backgroundColor: {
      default: "transparent",
      "@media (prefers-color-scheme: dark)": {
        default: `color-mix(in oklab, ${color.input} 30%, transparent)`,
        ":hover": `color-mix(in oklab, ${color.input} 50%, transparent)`
      }
    }
  },
  // Was `*:data-[slot=select-value]:*` on the trigger; StyleX has no child
  // selectors, so it lives on SelectValue itself — same element either way.
  value: {
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    overflow: "hidden"
  },

  content: {
    position: "relative",
    zIndex: 50,
    maxHeight: "var(--radix-select-content-available-height)",
    minWidth: space.x128,
    transformOrigin: "var(--radix-select-content-transform-origin)",
    overflowX: "hidden",
    overflowY: "auto",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    // Bare `border` in Tailwind leaves the colour at the preflight default
    // (`border: 0 solid` => currentColor). Preserved verbatim.
    borderColor: "currentColor",
    backgroundColor: color.popover,
    color: color.popoverForeground,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
  },
  contentPopper: {
    transform: {
      default: null,
      '[data-side="bottom"]': `translateY(${space.x4})`,
      '[data-side="top"]': `translateY(calc(${space.x4} * -1))`,
      '[data-side="left"]': `translateX(calc(${space.x4} * -1))`,
      '[data-side="right"]': `translateX(${space.x4})`
    }
  },
  viewport: {
    padding: space.x4
  },
  viewportPopper: {
    height: "var(--radix-select-trigger-height)",
    width: "100%",
    minWidth: "var(--radix-select-trigger-width)",
    scrollMarginBlock: space.x4
  },

  label: {
    paddingInline: space.x8,
    paddingBlock: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.mutedForeground
  },
  item: {
    position: "relative",
    display: "flex",
    width: "100%",
    cursor: "default",
    alignItems: "center",
    gap: space.x8,
    borderRadius: radius.sm,
    paddingBlock: space.x6,
    paddingRight: space.x32,
    paddingLeft: space.x8,
    fontSize: text.sm,
    lineHeight: leading.sm,
    outlineStyle: "none",
    userSelect: "none",
    backgroundColor: { default: null, ":focus": color.accent },
    color: { default: null, ":focus": color.accentForeground },
    pointerEvents: { default: null, "[data-disabled]": "none" },
    opacity: { default: null, "[data-disabled]": 0.5 }
  },
  itemIndicator: {
    position: "absolute",
    right: space.x8,
    display: "flex",
    height: space.x14,
    width: space.x14,
    alignItems: "center",
    justifyContent: "center"
  },
  separator: {
    pointerEvents: "none",
    // `-mx-1 my-1` — negative margins have no token, derived from space.x4.
    marginInline: `calc(${space.x4} * -1)`,
    marginBlock: space.x4,
    height: "1px",
    backgroundColor: color.border
  },
  scrollButton: {
    display: "flex",
    cursor: "default",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: space.x4
  },
  triggerIcon: {
    height: space.x16,
    width: space.x16,
    opacity: 0.5,
    pointerEvents: "none",
    flexShrink: 0
  }
});

const triggerSizes = stylex.create({
  default: { height: space.x36 },
  sm: { height: space.x32 }
});

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  style,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Value>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Value data-slot="select-value" {...props} {...stylex.props(s.value, style)} />
  );
}

function SelectTrigger({
  style,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, "className" | "style"> & {
  size?: "sm" | "default";
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      {...props}
      {...stylex.props(s.trigger, triggerSizes[size], style)}
    >
      {children}
      {/* asChild: the compiled styles must land on the icon, not the Icon primitive. */}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon {...stylex.props(s.triggerIcon)} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  style,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Content>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        align={align}
        {...props}
        {...stylex.props(s.content, position === "popper" && s.contentPopper, style)}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          {...stylex.props(s.viewport, position === "popper" && s.viewportPopper)}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  style,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Label>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Label data-slot="select-label" {...props} {...stylex.props(s.label, style)} />
  );
}

function SelectItem({
  style,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Item>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Item data-slot="select-item" {...props} {...stylex.props(s.item, style)}>
      <span data-slot="select-item-indicator" {...stylex.props(s.itemIndicator)}>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon {...stylex.props(shared.iconStatic)} />
        </SelectPrimitive.ItemIndicator>
      </span>
      {/* Was `*:[span]:last:*` on the item — that last span is exactly this one. */}
      <SelectPrimitive.ItemText {...stylex.props(shared.row)}>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  style,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Separator>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      {...props}
      {...stylex.props(s.separator, style)}
    />
  );
}

function SelectScrollUpButton({
  style,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      {...props}
      {...stylex.props(s.scrollButton, style)}
    >
      <ChevronUpIcon {...stylex.props(shared.iconStatic)} />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  style,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      {...props}
      {...stylex.props(s.scrollButton, style)}
    >
      <ChevronDownIcon {...stylex.props(shared.iconStatic)} />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
};
