import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { Separator as SeparatorPrimitive } from "radix-ui";
import { color } from "@/tokens.stylex";

const s = stylex.create({
  separator: {
    flexShrink: 0,
    backgroundColor: color.border,
    height: {
      default: null,
      '[data-orientation="horizontal"]': "1px",
      '[data-orientation="vertical"]': "100%"
    },
    width: {
      default: null,
      '[data-orientation="horizontal"]': "100%",
      '[data-orientation="vertical"]': "1px"
    }
  }
});

type SeparatorProps = Omit<
  React.ComponentProps<typeof SeparatorPrimitive.Root>,
  "className" | "style"
> & {
  style?: stylex.StyleXStyles;
};

function Separator({ style, orientation = "horizontal", decorative = true, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
      {...stylex.props(s.separator, style)}
    />
  );
}

export { Separator };
