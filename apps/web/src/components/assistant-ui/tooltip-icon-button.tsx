"use client";

import { type ComponentPropsWithRef, forwardRef } from "react";
import { Slot } from "radix-ui";
import * as stylex from "@stylexjs/stylex";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { space } from "@/tokens.stylex";

// `sx` here is already `stylex.StyleXStyles` — it comes from ButtonProps,
// which dropped `className` when it moved to StyleX.
export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

const s = stylex.create({
  icon: {
    height: space.x24,
    width: space.x24,
    padding: space.x4,
    // Tighter than the base button's 0.96 — an icon button is small enough
    // that the press needs to read at a glance.
    transform: { default: null, ":active": "scale(0.9)" }
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: space.x0,
    margin: "-1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0
  }
});

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", sx, className, ...rest }, ref) => {
  const srOnly = stylex.props(s.srOnly);

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            {...rest}
            // Semantic hooks only, per Button's contract.
            className={className ? `aui-button-icon ${className}` : "aui-button-icon"}
            sx={[s.icon, sx]}
            ref={ref}
          >
            <Slot.Slottable>{children}</Slot.Slottable>
            <span
              {...srOnly}
              className={`aui-sr-only ${srOnly.className ?? ""}`}
            >
              {tooltip}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
