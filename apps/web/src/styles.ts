import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text, tracking } from "@/tokens.stylex";

// Cross-page primitives — the styles that were copied into three or more files
// during the Tailwind migration and are the ones that drift first (every page
// title, every subtitle, every empty state).
//
// This is deliberately NOT a home for all styling. Styles belong next to the
// markup they style; only a shape repeated across unrelated files earns a place
// here. There is no bundle argument either way — StyleX compiles to atomic
// classes, so ten files declaring `display: flex` already emit one rule. This
// exists for consistency, not for bytes.
//
// Compose shared first, local second — `stylex.props` resolves later arguments
// last, so `stylex.props(shared.row, s.header)` lets the local style override:
//
//   <div {...stylex.props(shared.row, s.header)} />
export const shared = stylex.create({
  // — layout ————————————————————————————————————————————————
  /** flex row, centred, 8px gap. The default "label and its icon" row. */
  row: { display: "flex", alignItems: "center", gap: space.x8 },
  /** Same, 6px gap — tighter pairings like a status dot and its text. */
  rowTight: { display: "flex", alignItems: "center", gap: space.x6 },
  /** Vertical stack, 8px gap. */
  stack: { display: "flex", flexDirection: "column", gap: space.x8 },
  /** A route's outermost column: 24px rhythm, capped at 56rem. */
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x896 },
  /** Grow into the row and allow truncation — `min-width: 0` is the load-bearing half. */
  fill: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: "0%" },

  // — type ——————————————————————————————————————————————————
  /** Page `<h1>`. */
  pageTitle: {
    fontSize: text.xl2,
    lineHeight: leading.xl2,
    fontWeight: 700,
    letterSpacing: tracking.tight,
  },
  /** The one-line subtitle under a page title. */
  lede: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc500,
    marginTop: space.x4,
  },
  /** Secondary body copy — hints, meta lines, labels. */
  meta: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc400 },
  /** Digits that must not jitter as they change. */
  tabular: { fontVariantNumeric: "tabular-nums" },
  /** Single-line ellipsis. Needs a `min-width: 0` ancestor — see `fill`. */
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  // — marks —————————————————————————————————————————————————
  /** 6px status dot. Pair with a background colour from the caller. */
  dot: { height: space.x6, width: space.x6, borderRadius: radius.full },
  /** 8px status dot. */
  dotLarge: { height: space.x8, width: space.x8, borderRadius: radius.full },
  /** 16px icon box. */
  icon: { width: space.x16, height: space.x16 },
  /** 16px decorative icon: never a click target, never squashed by flex. */
  iconStatic: { pointerEvents: "none", flexShrink: 0, width: space.x16, height: space.x16 },

  // — links —————————————————————————————————————————————————
  /** Quiet link that brightens on hover. */
  ghostLink: { color: { default: color.zinc500, ":hover": color.zinc300 } },
  /** The "← back to X" link above a detail page's title. */
  backLink: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: { default: color.zinc400, ":hover": color.zinc100 },
    display: "flex",
    alignItems: "center",
    gap: space.x4,
  },

  // — empty states ——————————————————————————————————————————
  /** Dashed placeholder panel for "nothing here yet". */
  emptyBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: color.zinc800,
    paddingBlock: space.x64,
    textAlign: "center",
  },
  /** The headline inside an `emptyBox`. */
  emptyTitle: {
    marginTop: space.x12,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc400,
  },
});

// Deliberately absent: the bare status fills (`backgroundColor: color.dangerDot`
// / `okDot` / `zinc500`). They recur in three or four files, but severity and
// trigger colours already have a home in components/charts/colors.ts plus the
// local maps in review-detail and dashboard. A third overlapping palette would
// cost more than four one-line declarations. Same for one-property colour
// styles like `color: color.mutedForeground` — a named export buys nothing over
// writing the token.
