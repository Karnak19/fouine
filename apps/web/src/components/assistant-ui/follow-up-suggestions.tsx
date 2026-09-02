"use client";

import { AuiIf, useAuiState, ThreadPrimitive } from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import * as stylex from "@stylexjs/stylex";
import { color, radius, space, text } from "@/tokens.stylex";

const s = stylex.create({
  scroller: {
    // overflow-x clips both axes; the vertical padding + negative margin gives
    // focus rings room without changing the outer height.
    marginBlock: "-0.25rem",
    paddingBlock: space.x4,
    width: "100%",
    overflowX: "auto",
    msOverflowStyle: "none",
    scrollbarWidth: "none",
    "::-webkit-scrollbar": { display: "none" }
  },
  // Dynamic: the fade edges depend on how far the row is scrolled.
  mask: (image: string) => ({ maskImage: image }),
  row: {
    marginInline: "auto",
    display: "flex",
    minHeight: space.x32,
    width: "max-content",
    alignItems: "center",
    gap: space.x8,
    paddingInline: space.x2
  },
  suggestion: {
    backgroundColor: {
      default: color.background,
      ":hover": `color-mix(in oklab, ${color.muted} 80%, transparent)`
    },
    borderRadius: radius.full,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "currentColor",
    paddingInline: space.x12,
    paddingBlock: space.x4,
    fontSize: text.sm,
    lineHeight: "calc(1.25 / 0.875)",
    whiteSpace: "nowrap",
    transitionProperty: "color, background-color, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 1, 1)"
  }
});

const FollowupSuggestionsRow: FC = () => {
  const suggestions = useAuiState((s) => s.thread.suggestions);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rtlRef = useRef<boolean | null>(null);
  const [fades, setFades] = useState({ left: false, right: false });

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    // scrollLeft runs 0..-max in RTL; normalize to hidden width per physical edge.
    const fromStart = Math.abs(el.scrollLeft);
    // getComputedStyle forces a style recalc per scroll event; direction is stable, read it once.
    const rtl = (rtlRef.current ??= getComputedStyle(el).direction === "rtl");
    const [left, right] = rtl
      ? [maxScroll - fromStart, fromStart]
      : [fromStart, maxScroll - fromStart];
    setFades((prev) => {
      const next = { left: left > 1, right: right > 1 };
      return prev.left === next.left && prev.right === next.right ? prev : next;
    });
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollRef.current;
    if (!el?.firstElementChild) return undefined;
    const observer = new ResizeObserver(updateFades);
    observer.observe(el);
    observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [updateFades]);

  const maskImage = `linear-gradient(to right, ${
    fades.left ? "transparent, black 2rem" : "black"
  }, ${fades.right ? "black calc(100% - 2rem), transparent" : "black"})`;

  const scroller = stylex.props(s.scroller, s.mask(maskImage));

  return (
    <div
      ref={scrollRef}
      onScroll={updateFades}
      {...scroller}
      className={`aui-thread-followup-suggestions ${scroller.className ?? ""}`}
    >
      <div {...stylex.props(s.row)}>
        {suggestions.map((suggestion, idx) => {
          const item = stylex.props(s.suggestion);
          return (
            <ThreadPrimitive.Suggestion
              key={idx}
              {...item}
              className={`aui-thread-followup-suggestion ${item.className ?? ""}`}
              prompt={suggestion.prompt}
              method="replace"
              autoSend
            >
              {suggestion.prompt}
            </ThreadPrimitive.Suggestion>
          );
        })}
      </div>
    </div>
  );
};

export const ThreadFollowupSuggestions: FC = () => (
  <AuiIf
    condition={(s) =>
      !s.thread.isEmpty &&
      !s.thread.isRunning &&
      s.thread.suggestions.length > 0
    }
  >
    <FollowupSuggestionsRow />
  </AuiIf>
);
