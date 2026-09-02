import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import * as stylex from "@stylexjs/stylex";
import { color, radius, shadow, space } from "@/tokens.stylex";

// No enter/exit animation on purpose. The Tailwind original carried
// `animate-in fade-in-0 zoom-in-95 slide-in-from-*-2` / `animate-out`, but
// those come from `tw-animate-css`, which is not installed — they emit no CSS,
// so the card appears instantly today and must keep doing so.
const s = stylex.create({
  content: {
    zIndex: 50,
    width: space.x256,
    transformOrigin: "var(--radix-hover-card-content-transform-origin)",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.popover,
    padding: space.x16,
    color: color.popoverForeground,
    boxShadow: shadow.md,
    outlineStyle: "none"
  }
});

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

type HoverCardContentProps = Omit<
  React.ComponentProps<typeof HoverCardPrimitive.Content>,
  "className" | "style"
> & { style?: stylex.StyleXStyles };

function HoverCardContent({
  style,
  align = "center",
  sideOffset = 4,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        {...props}
        {...stylex.props(s.content, style)}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
