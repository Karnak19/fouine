# fouine — design

Self-hosted AI code reviewer. Product UI (a tool that serves the task), glanced
at by a developer checking review status. Dark, always: it lives next to a
terminal and a PR tab.

## Identity: "marten warm"

A fouine is a stone marten, warm brown coat with a cream throat. The UI leans
into that and deliberately avoids the dev-tool-blue reflex.

- **Neutrals** are warm-tinted charcoal/taupe (OKLCH hue ~66–70, chroma ~0.008).
  The whole UI reads off Tailwind's `zinc-*` scale, which `global.css` remaps to
  these warm values, so one change recolors every page.
- **Accent: ember** (`ember-*`, OKLCH ~55–66 hue). The single accent, used only
  for: running reviews, links, primary actions, focus ring, active nav. Never
  decoration.
- **Status semantics:** running = ember, completed = emerald, failed = red,
  pending = neutral. Green/red stay unambiguously green/red (ember never doubles
  as success).

Never `#000`/`#fff`. Never gradient text, glass, or side-stripe accents (the nav
active state is an ember fill + text, not a left border).

## Type & layout

- System font stack. One family carries everything.
- Hierarchy via weight + scale, tabular-nums for all numbers/costs/times.
- Cards earn their place: the dashboard stat strip is one bordered container with
  internal dividers, not four repeated cards. No nested cards.

## Motion

- Only `fouine-pulse` on live/running indicators. No page-load choreography.

## Tokens

All defined in `public/global.css` under `@theme`: warm `zinc-*` overrides,
`ember-*` scale, and the shadcn semantic vars (`primary`/`ring`/`accent` point at
ember). Components consume `zinc-*`/`ember-*` utilities directly.
