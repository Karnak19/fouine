"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import * as stylex from "@stylexjs/stylex";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent
} from "@assistant-ui/react";
import { StreamdownText } from "@/components/assistant-ui/streamdown-text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { color, radius, space, text } from "@/tokens.stylex";

const ANIMATION_DURATION = 200;

type ReasoningVariant = "outline" | "ghost" | "muted";

const ReasoningPreviewContext = createContext(false);

// The fade's tint used to key off the root through
// `group-data-[variant=muted]/reasoning-root:` and the chevron off
// `group-data-open/trigger:`. StyleX has no parent selector, so the Root — which
// already knows both — hands them down. Markup and data attributes are unchanged.
const ReasoningRootContext = createContext<{
  variant?: ReasoningVariant;
  open: boolean;
}>({ open: false });

const s = stylex.create({
  root: { marginBottom: space.x16, width: "100%" },

  fade: {
    pointerEvents: "none",
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    height: space.x32,
    transitionDuration: "var(--animation-duration)"
  },
  fadeTop: {
    top: 0,
    backgroundImage:
      "linear-gradient(to bottom, var(--color-background), transparent)"
  },
  fadeTopMuted: {
    backgroundImage:
      "linear-gradient(to bottom, color-mix(in oklab, var(--color-muted) 50%, var(--color-background)), transparent)"
  },
  fadeBottom: {
    bottom: 0,
    backgroundImage:
      "linear-gradient(to top, var(--color-background), transparent)"
  },
  fadeBottomMuted: {
    backgroundImage:
      "linear-gradient(to top, color-mix(in oklab, var(--color-muted) 50%, var(--color-background)), transparent)"
  },

  trigger: {
    display: "flex",
    maxWidth: "75%",
    transformOrigin: "0",
    alignItems: "center",
    gap: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: 1.42857,
    color: { default: color.mutedForeground, ":hover": color.foreground },
    transitionProperty: "color, scale",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    scale: { default: null, ":active": "0.98" }
  },

  icon: { width: space.x16, height: space.x16, flexShrink: 0 },

  label: {
    position: "relative",
    display: "inline-block",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums"
  },

  shimmer: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    animationName: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": "none"
    }
  },

  chevron: {
    marginTop: space.x2,
    width: space.x16,
    height: space.x16,
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
    color: color.mutedForeground,
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

  textScroller: {
    position: "relative",
    zIndex: 0,
    maxHeight: space.x256,
    overflowY: "auto",
    paddingInlineStart: space.x24,
    paddingTop: space.x8,
    paddingBottom: space.x8,
    lineHeight: 1.625,
    textWrap: "pretty",
    transform: "translateZ(0)",
    transitionProperty: {
      default: "transform, opacity",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    transitionDuration: "var(--animation-duration)",
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)"
  },
  // `space-y-4` is a child-combinator rule StyleX cannot express; a column
  // flex box with the same 1rem gap is the equivalent for block children.
  textContent: {
    display: "flex",
    flexDirection: "column",
    rowGap: space.x16
  }
});

const rootVariants = stylex.create({
  outline: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingInline: space.x12,
    paddingBlock: space.x8
  },
  ghost: {},
  muted: {
    backgroundColor: "color-mix(in oklab, var(--color-muted) 50%, transparent)",
    borderRadius: radius.lg,
    paddingInline: space.x12,
    paddingBlock: space.x8
  }
});

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange" | "className" | "style"
> & {
  variant?: ReasoningVariant;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  style?: stylex.StyleXStyles;
  /**
   * Whether the reasoning is currently streaming. While `true` the
   * disclosure is held open with a bottom-pinned live preview; when
   * streaming ends it returns to `defaultOpen`, and the first manual
   * toggle takes over the open/close state permanently. The live preview
   * keeps following the newest tokens while the disclosure is open during
   * streaming, even after a manual toggle, and pauses while the reader is
   * scrolled up.
   */
  streaming?: boolean;
};

function ReasoningRoot({
  style,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  streaming,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const initialOpenRef = useRef(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled
    ? controlledOpen
    : (userOpen ?? (streaming || initialOpenRef.current));
  const isPreview = streaming === true && isOpen;

  const prevStreamingRef = useRef(streaming);
  useLayoutEffect(() => {
    if (prevStreamingRef.current === streaming) return;
    prevStreamingRef.current = streaming;
    // A streaming transition only animates the panel when the resting state
    // is collapsed; with `defaultOpen` the disclosure stays open across it.
    if (!isControlled && userOpen === null && !initialOpenRef.current) {
      lockScroll();
    }
  }, [streaming, isControlled, userOpen, lockScroll]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      if (!isControlled) {
        setUserOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  const sx = stylex.props(s.root, rootVariants[variant ?? "outline"], style);

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      {...props}
      className={`aui-reasoning-root ${sx.className ?? ""}`}
      style={
        {
          ...sx.style,
          "--animation-duration": `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
    >
      <ReasoningRootContext.Provider value={{ variant, open: isOpen }}>
        <ReasoningPreviewContext.Provider value={isPreview}>
          {children}
        </ReasoningPreviewContext.Provider>
      </ReasoningRootContext.Provider>
    </Collapsible>
  );
}

function ReasoningFade({
  side = "bottom",
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  side?: "top" | "bottom";
  style?: stylex.StyleXStyles;
}) {
  const { variant } = useContext(ReasoningRootContext);
  const isMuted = variant === "muted";

  const sx =
    side === "top"
      ? stylex.props(s.fade, s.fadeTop, isMuted && s.fadeTopMuted, style)
      : stylex.props(s.fade, s.fadeBottom, isMuted && s.fadeBottomMuted, style);

  return (
    <div
      data-slot="reasoning-fade"
      {...props}
      className={`aui-reasoning-fade ${sx.className ?? ""}`}
      style={sx.style}
    />
  );
}

function ReasoningTrigger({
  active,
  duration,
  style,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleTrigger>,
  "className" | "style"
> & {
  active?: boolean;
  duration?: number;
  style?: stylex.StyleXStyles;
}) {
  const { open } = useContext(ReasoningRootContext);
  const durationText = duration ? ` (${duration}s)` : "";

  const sx = stylex.props(s.trigger, style);
  const iconSx = stylex.props(s.icon);
  const labelSx = stylex.props(s.label);
  const shimmerSx = stylex.props(s.shimmer);
  const chevronSx = stylex.props(
    s.chevron,
    open ? s.chevronOpen : s.chevronClosed,
  );

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      {...props}
      className={`aui-reasoning-trigger ${sx.className ?? ""}`}
      style={sx.style}
    >
      <BrainIcon
        data-slot="reasoning-trigger-icon"
        className={`aui-reasoning-trigger-icon ${iconSx.className ?? ""}`}
        style={iconSx.style}
      />
      <span
        data-slot="reasoning-trigger-label"
        className={`aui-reasoning-trigger-label-wrapper ${labelSx.className ?? ""}`}
        style={labelSx.style}
      >
        <span>Reasoning{durationText}</span>
        {active ? (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            // `shimmer` is vendored by tw-shimmer, not ours to migrate.
            className={`aui-reasoning-trigger-shimmer shimmer ${shimmerSx.className ?? ""}`}
            style={shimmerSx.style}
          >
            Reasoning{durationText}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={`aui-reasoning-trigger-chevron ${chevronSx.className ?? ""}`}
        style={chevronSx.style}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  style,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleContent>,
  "className" | "style"
> & { style?: stylex.StyleXStyles }) {
  const isPreview = useContext(ReasoningPreviewContext);
  const sx = stylex.props(s.content, style);

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      {...props}
      className={`aui-reasoning-content ${sx.className ?? ""}`}
      style={sx.style}
    >
      <ReasoningFade side="top" />
      {children}
      {isPreview ? <ReasoningFade /> : null}
    </CollapsibleContent>
  );
}

function ReasoningText({
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  const isPreview = useContext(ReasoningPreviewContext);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreview) return;
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    let pinned = true;
    let lastScrollTop = scrollEl.scrollTop;
    let lastScrollHeight = scrollEl.scrollHeight;
    const isAtBottom = () =>
      Math.abs(
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight,
      ) <= 1 || scrollEl.scrollHeight <= scrollEl.clientHeight;

    const pin = () => {
      if (!pinned) return;
      scrollEl.scrollTop = scrollEl.scrollHeight;
    };
    // A pin's own scroll event can arrive after new content grew the scroll
    // height and read as "not at bottom"; only an upward move at unchanged
    // scroll height is user intent.
    const onScroll = () => {
      if (isAtBottom()) {
        pinned = true;
      } else if (
        scrollEl.scrollTop < lastScrollTop &&
        scrollEl.scrollHeight === lastScrollHeight
      ) {
        pinned = false;
      }
      lastScrollTop = scrollEl.scrollTop;
      lastScrollHeight = scrollEl.scrollHeight;
    };

    pin();
    scrollEl.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(pin);
    observer.observe(contentEl);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [isPreview]);

  const sx = stylex.props(s.textScroller, style);
  const contentSx = stylex.props(s.textContent);

  return (
    <div
      ref={scrollRef}
      data-slot="reasoning-text"
      {...props}
      className={`aui-reasoning-text ${sx.className ?? ""}`}
      style={sx.style}
    >
      <div
        ref={contentRef}
        className={`aui-reasoning-text-content ${contentSx.className ?? ""}`}
        style={contentSx.style}
      >
        {children}
      </div>
    </div>
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <StreamdownText />;

const ReasoningGroupImpl: ReasoningGroupComponent = ({
  children,
  startIndex,
  endIndex
}) => {
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    for (let index = startIndex; index <= endIndex; index++) {
      if (s.message.parts[index]?.status.type === "running") return true;
    }
    return false;
  });

  return (
    <ReasoningRoot streaming={isReasoningStreaming}>
      <ReasoningTrigger active={isReasoningStreaming} />
      <ReasoningContent aria-busy={isReasoningStreaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const Reasoning = memo(
  ReasoningImpl,
) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
  Fade: typeof ReasoningFade;
};

Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;
Reasoning.Fade = ReasoningFade;

/**
 * @deprecated This wrapper targets the legacy `components.ReasoningGroup`
 * prop on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>`
 * with a `groupBy` returning `"group-reasoning"` and compose `ReasoningRoot`
 * / `ReasoningTrigger` / `ReasoningContent` / `ReasoningText` directly.
 * See `thread.tsx` for an example.
 */
const ReasoningGroup = memo(ReasoningGroupImpl);
ReasoningGroup.displayName = "ReasoningGroup";

export {
  Reasoning,
  ReasoningGroup,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade
};
