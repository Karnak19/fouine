"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";

// No enter/exit animation on purpose. The Tailwind original carried
// `animate-in fade-in-0 zoom-in-95 slide-in-from-*-2` / `animate-out`, but
// those come from `tw-animate-css`, which is not installed — they emit no CSS,
// so the tooltip appears instantly today and must keep doing so.
const s = stylex.create({
  content: {
    zIndex: 50,
    width: "fit-content",
    transformOrigin: "var(--radix-tooltip-content-transform-origin)",
    borderRadius: radius.md,
    backgroundColor: color.foreground,
    paddingInline: space.x12,
    paddingBlock: space.x6,
    fontSize: text.xs, lineHeight: leading.xs,
    textWrap: "balance",
    color: color.background
  },
  arrow: {
    zIndex: 50,
    width: space.x10,
    height: space.x10,
    transform: "translateY(calc(-50% - 2px)) rotate(45deg)",
    borderRadius: radius.sm,
    backgroundColor: color.foreground,
    fill: color.foreground
  }
});

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  "className" | "style"
> & { style?: stylex.StyleXStyles };

function TooltipContent({ style, sideOffset = 0, children, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...props}
        {...stylex.props(s.content, style)}
      >
        {children}
        <TooltipPrimitive.Arrow {...stylex.props(s.arrow)} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
