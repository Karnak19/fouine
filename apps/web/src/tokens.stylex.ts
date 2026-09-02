// The only place StyleX code may name a design value.
//
// Values here are indirections onto the Tailwind `@theme static` block in
// global.css, which stays the single source of truth: Tailwind still has to
// generate utilities for streamdown's vendored classes, so duplicating the
// palette into StyleX would give us two scales that drift.
//
// Two rules, both load-bearing:
//  1. Never write a raw colour literal inside `stylex.create`. StyleX runs
//     lightningcss over values and downlevels `oklch()` to `lab()` with a hex
//     fallback per browserslist. Through `var(--color-*)` the value passes
//     untouched, so OKLCH survives to the browser.
//  2. Shared values MUST live in a `*.stylex.ts` file and go through
//     `defineVars`. Importing a plain `const` object into `stylex.create`
//     fails the build with "Could not resolve the path to the imported file".
import * as stylex from "@stylexjs/stylex";

export const color = stylex.defineVars({
  background: "var(--color-background)",
  foreground: "var(--color-foreground)",
  card: "var(--color-card)",
  cardForeground: "var(--color-card-foreground)",
  popover: "var(--color-popover)",
  popoverForeground: "var(--color-popover-foreground)",
  primary: "var(--color-primary)",
  primaryForeground: "var(--color-primary-foreground)",
  secondary: "var(--color-secondary)",
  secondaryForeground: "var(--color-secondary-foreground)",
  muted: "var(--color-muted)",
  mutedForeground: "var(--color-muted-foreground)",
  accent: "var(--color-accent)",
  accentForeground: "var(--color-accent-foreground)",
  destructive: "var(--color-destructive)",
  destructiveForeground: "var(--color-destructive-foreground)",
  border: "var(--color-border)",
  input: "var(--color-input)",
  ring: "var(--color-ring)",

  zinc50: "var(--color-zinc-50)",
  zinc100: "var(--color-zinc-100)",
  zinc200: "var(--color-zinc-200)",
  zinc300: "var(--color-zinc-300)",
  zinc400: "var(--color-zinc-400)",
  zinc500: "var(--color-zinc-500)",
  zinc600: "var(--color-zinc-600)",
  zinc700: "var(--color-zinc-700)",
  zinc800: "var(--color-zinc-800)",
  zinc900: "var(--color-zinc-900)",
  zinc950: "var(--color-zinc-950)",

  ember200: "var(--color-ember-200)",
  ember300: "var(--color-ember-300)",
  ember400: "var(--color-ember-400)",
  ember500: "var(--color-ember-500)",
  ember600: "var(--color-ember-600)",
  ember800: "var(--color-ember-800)",
  ember950: "var(--color-ember-950)",

  // Categorical ramp — index order is load-bearing, see charts/colors.ts.
  cat1: "var(--color-cat-1)",
  cat2: "var(--color-cat-2)",
  cat3: "var(--color-cat-3)",
  cat4: "var(--color-cat-4)",
  cat5: "var(--color-cat-5)",

  okDot: "var(--color-ok-dot)",
  okText: "var(--color-ok-text)",
  warnDot: "var(--color-warn-dot)",
  warnText: "var(--color-warn-text)",
  dangerDot: "var(--color-danger-dot)",
  dangerText: "var(--color-danger-text)",
  // Tailwind red-200. The message-error text was `dark:text-red-200`, lighter
  // than dangerText (red-300) — kept exact rather than rounded to the nearest.
  dangerTextSoft: "var(--color-danger-text-soft)",
  dangerSurface: "var(--color-danger-surface)",
  dangerSurfaceHover: "var(--color-danger-surface-hover)",
  okSurface: "var(--color-ok-surface)",
  okSurfaceDeep: "var(--color-ok-surface-deep)",
  dangerSurfaceDeep: "var(--color-danger-surface-deep)",
  infoText: "var(--color-info-text)",
  infoSurface: "var(--color-info-surface)",
  infoSurfaceDeep: "var(--color-info-surface-deep)",
  warnSurface: "var(--color-warn-surface)",
  warnSurfaceDeep: "var(--color-warn-surface-deep)",
  warnStrong: "var(--color-warn-strong)",
});

// Base-4 scale. Named by px so `space.x12` reads as 12px / 0.75rem, which is
// what the Tailwind classes being replaced meant (`p-3` === 0.75rem).
export const space = stylex.defineVars({
  x0: "0",
  x2: "0.125rem",
  x4: "0.25rem",
  x6: "0.375rem",
  x8: "0.5rem",
  x10: "0.625rem",
  x12: "0.75rem",
  x14: "0.875rem",
  x16: "1rem",
  x20: "1.25rem",
  x24: "1.5rem",
  x28: "1.75rem",
  x30: "1.875rem",
  x32: "2rem",
  x36: "2.25rem",
  x40: "2.5rem",
  x56: "3.5rem",
  x48: "3rem",
  x64: "4rem",
  x96: "6rem",
  x128: "8rem",
  x256: "16rem",
  x208: "13rem",
  x320: "20rem",
  x1024: "64rem",
  x240: "15rem",
  x768: "48rem",
  x896: "56rem",
  x1280: "80rem",
  x224: "14rem",
  x160: "10rem",
});

export const radius = stylex.defineVars({
  sm: "0.125rem",
  // Tailwind's bare `rounded` / `rounded-t` / `rounded-b`.
  base: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  full: "9999px",
});

export const text = stylex.defineVars({
  // xxs and xsPlus are the two arbitrary sizes the old markup reached for
  // (`text-[0.7rem]`, `text-[0.8rem]`). Named rather than inlined so the next
  // label that needs one lands on the same value instead of a third.
  xxxs: "0.65rem",
  xxs: "0.7rem",
  xs: "0.75rem",
  xsPlus: "0.8rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  xl2: "1.5rem",
  xl3: "1.875rem",
});

export const tracking = stylex.defineVars({
  tight: "-0.025em",
  normal: "0",
  wide: "0.025em",
  widest: "0.1em",
});

// Plain sRGB on purpose — a shadow is not a palette colour, and rgb() is not
// subject to the oklch downlevelling that `color` exists to dodge. Values are
// Tailwind v4's, lifted verbatim so shadows survive losing the utilities.
export const shadow = stylex.defineVars({
  xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
});

// Tailwind's default stacks, verbatim. Two files had already inlined the mono
// stack as a local const; one definition beats three copies.
export const font = stylex.defineVars({
  sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
});

// Tailwind pairs every font-size with a line-height, so a `fontSize` set
// without its partner silently changes text metrics. Each key here is the
// companion of the same key in `text` — set both, always.
export const leading = stylex.defineVars({
  xxs: "calc(1 / 0.75)",
  xs: "calc(1 / 0.75)",
  sm: "calc(1.25 / 0.875)",
  base: "calc(1.5 / 1)",
  lg: "calc(1.75 / 1.125)",
  xl: "calc(1.75 / 1.25)",
  xl2: "calc(2 / 1.5)",
  xl3: "calc(2.25 / 1.875)",
  relaxed: "1.625",
});
