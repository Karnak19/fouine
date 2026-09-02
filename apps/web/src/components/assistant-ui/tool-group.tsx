"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useRef,
  useState,
  type FC,
  type PropsWithChildren
} from "react";
import * as stylex from "@stylexjs/stylex";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { useScrollLock } from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { color, radius, space, text } from "@/tokens.stylex";

const ANIMATION_DURATION = 200;

type ToolGroupVariant = "outline" | "ghost" | "muted";

// The trigger/content styling used to key off the root through
// `group-data-[variant=…]/tool-group-root:` and the chevron off
// `group-data-open/trigger:`. StyleX has no parent selector, so the Root — which
// already knows both — hands them down. Markup and data attributes are unchanged.
const ToolGroupRootContext = createContext<{
  variant: ToolGroupVariant;
  open: boolean;
}>({ variant: "outline", open: false });

const s = stylex.create({
  root: { width: "100%" },

  trigger: {
    display: "flex",
    transformOrigin: "0",
    alignItems: "center",
    gap: space.x8,
    fontSize: text.sm,
    lineHeight: 1.42857,
    transitionProperty: "color, scale",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    scale: { default: null, ":active": "0.98" }
  },

  loader: {
    width: space.x12,
    height: space.x12,
    flexShrink: 0,
    animationName: "spin",
    animationDuration: "0.6s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite"
  },

  label: {
    position: "relative",
    display: "inline-block",
    textAlign: "start",
    lineHeight: 1,
    fontWeight: 500
  },
  labelText: { fontSize: text.xs, lineHeight: 1.33333 },

  shimmer: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    fontSize: text.xs,
    lineHeight: 1.33333,
    animationName: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": "none"
    }
  },

  chevron: {
    width: space.x12,
    height: space.x12,
    flexShrink: 0,
    transitionProperty: {
      default: "transform, translate, scale, rotate",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    transitionDuration: "var(--animation-duration)",
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)"
  },
  chevronClosed: { rotate: "-90deg" },
  chevronOpen: { rotate: "0deg" },

  content: {
    position: "relative",
    overflowX: "hidden",
    overflowY: "hidden",
    fontSize: text.sm,
    lineHeight: 1.42857,
    outlineStyle: "none",
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
    transitionDuration: "var(--animation-duration)",
    // `collapsible-down` / `collapsible-up` are declared in global.css.
    animationName: {
      default: null,
      '[data-state="open"]': {
        default: "collapsible-down",
        "@media (prefers-reduced-motion: reduce)": "none"
      },
      '[data-state="closed"]': {
        default: "collapsible-up",
        "@media (prefers-reduced-motion: reduce)": "none"
      }
    },
    animationDuration: "var(--animation-duration)",
    animationFillMode: { default: null, '[data-state="closed"]': "forwards" },
    pointerEvents: { default: null, '[data-state="closed"]': "none" }
  },
  contentInner: {
    display: "flex",
    flexDirection: "column",
    marginTop: space.x8,
    gap: space.x8
  }
});

const rootVariants = stylex.create({
  outline: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingBlock: space.x12
  },
  ghost: {},
  muted: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor:
      "color-mix(in oklab, var(--color-muted-foreground) 30%, transparent)",
    backgroundColor: "color-mix(in oklab, var(--color-muted) 30%, transparent)",
    paddingBlock: space.x12
  }
});

const triggerVariants = stylex.create({
  outline: { width: "100%", paddingInline: space.x16 },
  ghost: {
    color: { default: color.mutedForeground, ":hover": color.foreground },
    paddingBlock: space.x6
  },
  muted: { width: "100%", paddingInline: space.x16 }
});

const labelVariants = stylex.create({
  outline: { flexGrow: 1 },
  ghost: { fontWeight: 400 },
  muted: { flexGrow: 1 }
});

const contentInnerVariants = stylex.create({
  outline: {
    marginTop: space.x12,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    paddingInline: space.x16,
    paddingTop: space.x12
  },
  ghost: { marginTop: space.x4, gap: space.x4 },
  muted: {
    marginTop: space.x12,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    paddingInline: space.x16,
    paddingTop: space.x12
  }
});

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange" | "className" | "style"
> & {
  variant?: ToolGroupVariant;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  style?: stylex.StyleXStyles;
};

function ToolGroupRoot({
  style,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const resolvedVariant = variant ?? "outline";

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  const sx = stylex.props(s.root, rootVariants[resolvedVariant], style);

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={resolvedVariant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      {...props}
      className={`aui-tool-group-root ${sx.className ?? ""}`}
      style={
        {
          ...sx.style,
          "--animation-duration": `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
    >
      <ToolGroupRootContext.Provider
        value={{ variant: resolvedVariant, open: isOpen }}
      >
        {children}
      </ToolGroupRootContext.Provider>
    </Collapsible>
  );
}

function ToolGroupTrigger({
  count,
  active = false,
  style,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleTrigger>,
  "className" | "style"
> & {
  count: number;
  active?: boolean;
  style?: stylex.StyleXStyles;
}) {
  const { variant, open } = useContext(ToolGroupRootContext);
  const label = `${count} tool ${count === 1 ? "call" : "calls"}`;

  const sx = stylex.props(s.trigger, triggerVariants[variant], style);
  const loaderSx = stylex.props(s.loader);
  const labelSx = stylex.props(s.label, labelVariants[variant]);
  const shimmerSx = stylex.props(s.shimmer);
  const chevronSx = stylex.props(
    s.chevron,
    open ? s.chevronOpen : s.chevronClosed,
  );

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      {...props}
      className={`aui-tool-group-trigger ${sx.className ?? ""}`}
      style={sx.style}
    >
      {active && (
        <LoaderIcon
          data-slot="tool-group-trigger-loader"
          className={`aui-tool-group-trigger-loader ${loaderSx.className ?? ""}`}
          style={loaderSx.style}
        />
      )}
      <span
        data-slot="tool-group-trigger-label"
        className={`aui-tool-group-trigger-label-wrapper ${labelSx.className ?? ""}`}
        style={labelSx.style}
      >
        <span {...stylex.props(s.labelText)}>{label}</span>
        {active && (
          <span
            aria-hidden
            data-slot="tool-group-trigger-shimmer"
            // `shimmer` is vendored by tw-shimmer, not ours to migrate.
            className={`aui-tool-group-trigger-shimmer shimmer ${shimmerSx.className ?? ""}`}
            style={shimmerSx.style}
          >
            {label}
          </span>
        )}
      </span>
      <ChevronDownIcon
        data-slot="tool-group-trigger-chevron"
        className={`aui-tool-group-trigger-chevron ${chevronSx.className ?? ""}`}
        style={chevronSx.style}
      />
    </CollapsibleTrigger>
  );
}

function ToolGroupContent({
  style,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleContent>,
  "className" | "style"
> & { style?: stylex.StyleXStyles }) {
  const { variant } = useContext(ToolGroupRootContext);
  const sx = stylex.props(s.content, style);

  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      {...props}
      className={`aui-tool-group-content ${sx.className ?? ""}`}
      style={sx.style}
    >
      <div
        {...stylex.props(s.contentInner, contentInnerVariants[variant])}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

type ToolGroupComponent = FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> & {
  Root: typeof ToolGroupRoot;
  Trigger: typeof ToolGroupTrigger;
  Content: typeof ToolGroupContent;
};

const ToolGroupImpl: FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ children, startIndex, endIndex }) => {
  const toolCount = endIndex - startIndex + 1;

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/**
 * @deprecated This wrapper targets the legacy `components.ToolGroup` prop
 * on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>` with
 * a `groupBy` returning `"group-tool"` and compose `ToolGroupRoot` /
 * `ToolGroupTrigger` / `ToolGroupContent` directly. See `thread.tsx`.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent;

ToolGroup.displayName = "ToolGroup";
ToolGroup.Root = ToolGroupRoot;
ToolGroup.Trigger = ToolGroupTrigger;
ToolGroup.Content = ToolGroupContent;

export { ToolGroup, ToolGroupRoot, ToolGroupTrigger, ToolGroupContent };
