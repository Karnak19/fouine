import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  srOnlyStyle
} from "@/components/ui/dialog";
import { color, leading, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  root: {
    display: "flex",
    height: "100%",
    width: "100%",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radius.md,
    backgroundColor: color.popover,
    color: color.popoverForeground
  },
  dialogContent: {
    overflow: "hidden",
    padding: space.x0
  },
  inputWrapper: {
    display: "flex",
    height: space.x36,
    alignItems: "center",
    gap: space.x8,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    paddingInline: space.x12
  },
  searchIcon: {
    width: space.x16,
    height: space.x16,
    flexShrink: 0,
    opacity: 0.5
  },
  input: {
    display: "flex",
    height: space.x40,
    width: "100%",
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "transparent",
    paddingBlock: space.x12,
    fontSize: text.sm, lineHeight: leading.sm,
    outline: "none",
    color: { default: "inherit", "::placeholder": color.mutedForeground },
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 }
  },
  list: {
    maxHeight: "300px",
    scrollPaddingBlock: space.x4,
    overflowX: "hidden",
    overflowY: "auto"
  },
  empty: {
    paddingBlock: space.x24,
    textAlign: "center",
    fontSize: text.sm, lineHeight: leading.sm
  },
  group: {
    overflow: "hidden",
    padding: space.x4,
    color: color.foreground
  },
  separator: {
    // No negative-space token exists; -mx-1 is -0.25rem.
    marginInline: "-0.25rem",
    height: "1px",
    backgroundColor: color.border
  },
  item: {
    position: "relative",
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: space.x8,
    borderRadius: radius.base,
    paddingInline: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm, lineHeight: leading.sm,
    outline: "none",
    userSelect: "none",
    pointerEvents: { default: null, '[data-disabled="true"]': "none" },
    opacity: { default: null, '[data-disabled="true"]': 0.5 },
    backgroundColor: { default: null, '[data-selected="true"]': color.accent },
    color: { default: null, '[data-selected="true"]': color.accentForeground }
  },
  shortcut: {
    marginLeft: "auto",
    fontSize: text.xs, lineHeight: leading.xs,
    letterSpacing: "0.1em",
    color: color.mutedForeground
  }
});

function Command({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <CommandPrimitive data-slot="command" {...props} {...stylex.props(s.root, style)} />;
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  style,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  style?: stylex.StyleXStyles;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader style={srOnlyStyle}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent style={[s.dialogContent, style]} showCloseButton={showCloseButton}>
        {/* The original className here was entirely descendant overrides of
            cmdk-rendered nodes ([&_[cmdk-group-heading]], [&_[cmdk-input]], …).
            StyleX has no descendant combinator, so they are gone — see the
            migration report. */}
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <div data-slot="command-input-wrapper" {...stylex.props(s.inputWrapper)}>
      <SearchIcon {...stylex.props(s.searchIcon)} />
      <CommandPrimitive.Input
        data-slot="command-input"
        {...props}
        {...stylex.props(s.input, style)}
      />
    </div>
  );
}

function CommandList({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.List>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <CommandPrimitive.List data-slot="command-list" {...props} {...stylex.props(s.list, style)} />
  );
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" {...props} {...stylex.props(s.empty)} />;
}

function CommandGroup({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Group>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <CommandPrimitive.Group data-slot="command-group" {...props} {...stylex.props(s.group, style)} />
  );
}

function CommandSeparator({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Separator>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      {...props}
      {...stylex.props(s.separator, style)}
    />
  );
}

function CommandItem({
  style,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Item>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <CommandPrimitive.Item data-slot="command-item" {...props} {...stylex.props(s.item, style)} />
  );
}

function CommandShortcut({
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <span data-slot="command-shortcut" {...props} {...stylex.props(s.shortcut, style)} />;
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator
};
