import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Inbox } from "lucide-react";
import { color, leading, radius, space, text } from "@/tokens.stylex";

// Panel chrome plus the two non-chart states. A panel always renders one of
// three things — PanelSkeleton while the data is undefined, PanelEmpty when it
// came back with no rows, the chart otherwise — because an empty window is a
// normal answer and must not look like a broken chart.

// Tailwind's `animate-pulse`. It has to be redeclared here: the @keyframes for
// it only exist while some className references the utility, so dropping the
// class would have deleted the animation too.
const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 }
});

const s = stylex.create({
  panel: {
    display: "flex",
    // min-width: 0 — grid/flex children default to min-width:auto, which makes
    // a panel expand to its widest table instead of letting that table scroll
    // inside its own overflow-x box — which on a phone pushes the whole page
    // sideways. Every grid wrapper around a panel carries min-width:0 for the
    // same reason.
    minWidth: 0,
    flexDirection: "column",
    gap: space.x10
  },
  title: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    textTransform: "uppercase",
    // tracking-wide. There is no letter-spacing group in tokens.stylex.ts.
    letterSpacing: "0.025em",
    color: color.zinc500
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.border,
    // bg-card/40 — color-mix over the token var rather than an element
    // `opacity`, which would fade the chart inside it too.
    backgroundColor: `color-mix(in oklab, ${color.card} 40%, transparent)`,
    overflow: "hidden"
  },
  skeleton: {
    display: "flex",
    flexDirection: "column",
    gap: space.x10,
    paddingInline: space.x16,
    paddingBlock: space.x14
  },
  skeletonRow: {
    height: space.x16,
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.muted} 70%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.x8,
    paddingInline: space.x16,
    paddingBlock: space.x40,
    textAlign: "center"
  },
  emptyIcon: { color: color.zinc700 },
  emptyLabel: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.mutedForeground
  },
  emptyHint: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc600
  }
});

export function Panel({
  title,
  children,
  style
}: {
  title: string;
  children: ReactNode;
  style?: stylex.StyleXStyles;
}) {
  return (
    <section {...stylex.props(s.panel, style)}>
      <h2 {...stylex.props(s.title)}>{title}</h2>
      {/* Deliberately a block, not a flex column: as a flex parent its children
          become flex items with min-width:auto, which lets a wide table grow
          past the panel instead of scrolling inside its own overflow-x box —
          the table then gets clipped by overflow-hidden and is unreachable on
          a phone. A chart gets its height from its own fixed height, not from
          this. */}
      <div {...stylex.props(s.body)}>{children}</div>
    </section>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div {...stylex.props(s.skeleton)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} {...stylex.props(s.skeletonRow)} />
      ))}
    </div>
  );
}

export function PanelEmpty({ label }: { label: string }) {
  return (
    <div {...stylex.props(s.empty)}>
      <Inbox size={18} {...stylex.props(s.emptyIcon)} />
      <p {...stylex.props(s.emptyLabel)}>{label}</p>
      <p {...stylex.props(s.emptyHint)}>Try a wider range or fewer filters.</p>
    </div>
  );
}
