import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { color, leading, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    backgroundColor: "rgb(0 0 0 / 0.5)"
  },
  content: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: 50,
    display: "grid",
    width: "100%",
    maxWidth: { default: "calc(100% - 2rem)", "@media (min-width: 640px)": "32rem" },
    transform: "translate(-50%, -50%)",
    gap: space.x16,
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.background,
    padding: space.x24,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    outline: "none"
  },
  close: {
    position: "absolute",
    top: space.x16,
    right: space.x16,
    borderRadius: radius.sm,
    borderWidth: 0,
    padding: space.x0,
    cursor: "pointer",
    backgroundColor: { default: "transparent", '[data-state="open"]': color.accent },
    color: { default: "inherit", '[data-state="open"]': color.mutedForeground },
    opacity: { default: 0.7, ":hover": 1 },
    transitionProperty: "opacity",
    transitionDuration: "150ms",
    outlineWidth: { default: 0, ":focus": "2px" },
    outlineStyle: "solid",
    outlineColor: color.ring,
    outlineOffset: "2px",
    pointerEvents: { default: null, ":disabled": "none" }
  },
  closeIcon: {
    pointerEvents: "none",
    flexShrink: 0,
    width: space.x16,
    height: space.x16
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.x8,
    textAlign: { default: "center", "@media (min-width: 640px)": "left" }
  },
  footer: {
    display: "flex",
    flexDirection: { default: "column-reverse", "@media (min-width: 640px)": "row" },
    gap: space.x8,
    justifyContent: { default: null, "@media (min-width: 640px)": "flex-end" }
  },
  title: {
    fontSize: text.lg,
    lineHeight: 1,
    fontWeight: 600
  },
  description: {
    fontSize: text.sm, lineHeight: leading.sm,
    color: color.mutedForeground
  }
});

// Exported so sibling components (command.tsx) can reuse the visually-hidden
// style without a second copy of the clip-rect recipe.
export const srOnlyStyle = s.srOnly;

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  style,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Overlay>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      {...props}
      {...stylex.props(s.overlay, style)}
    />
  );
}

function DialogContent({
  style,
  children,
  showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "className" | "style"> & {
  showCloseButton?: boolean;
  style?: stylex.StyleXStyles;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        {...props}
        {...stylex.props(s.content, style)}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" {...stylex.props(s.close)}>
            <XIcon {...stylex.props(s.closeIcon)} />
            <span {...stylex.props(s.srOnly)}>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return <div data-slot="dialog-header" {...props} {...stylex.props(s.header, style)} />;
}

function DialogFooter({
  style,
  showCloseButton = false,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  showCloseButton?: boolean;
  style?: stylex.StyleXStyles;
}) {
  return (
    <div data-slot="dialog-footer" {...props} {...stylex.props(s.footer, style)}>
      {children}
      {showCloseButton && (
        // asChild: the styles must live on the child, and Button already carries them.
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  style,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Title>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DialogPrimitive.Title data-slot="dialog-title" {...props} {...stylex.props(s.title, style)} />
  );
}

function DialogDescription({
  style,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Description>, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      {...props}
      {...stylex.props(s.description, style)}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
};
