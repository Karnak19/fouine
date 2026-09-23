---
name: fouine
description: Marten-warm dark ops dashboard — one ember accent on warm charcoal.
colors:
  ember-500: "oklch(0.7 0.16 55)"
  ember-400: "oklch(0.76 0.15 60)"
  ember-300: "oklch(0.82 0.11 66)"
  ember-800: "oklch(0.42 0.1 50)"
  ember-950: "oklch(0.25 0.05 52)"
  background: "oklch(0.16 0.008 66)"
  surface: "oklch(0.2 0.008 68)"
  surface-raised: "oklch(0.27 0.008 70)"
  border: "oklch(0.27 0.008 70)"
  foreground: "oklch(0.95 0.008 85)"
  muted-text: "oklch(0.68 0.007 75)"
  quiet-label: "oklch(0.58 0.007 72)"
  danger: "oklch(0.55 0.16 25)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  page: "28px"
  group: "10px"
  card: "24px"
  row: "10px 16px"
components:
  button-primary:
    backgroundColor: "{colors.ember-500}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ember-400}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  badge-running:
    backgroundColor: "{colors.ember-950}"
    textColor: "{colors.ember-300}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  nav-active:
    backgroundColor: "{colors.ember-950}"
    textColor: "{colors.ember-300}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip-trigger:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
---

# Design System: fouine

## Overview

**Creative North Star: "marten warm"**

A fouine is a stone marten — warm brown coat, cream throat — and the UI leans into that instead of the dev-tool-blue reflex. This is a product UI, a tool that serves the task: a developer glances at it between a terminal and a PR tab to check review status, then leaves. Dark, always. It lives next to a terminal, so it behaves like one: dense, quiet, tabular, no ceremony.

One family of warm charcoal neutrals carries every surface; a single ember accent marks the few things that are alive or actionable. Status is read at a glance from a fixed color grammar, never from decoration. Cards earn their place — sibling stats share one divided container rather than repeating card chrome. Motion is reserved for liveness: a running dot breathes, a skeleton shimmers while data loads, nothing else moves.

**Key Characteristics:**
- Dark-only warm charcoal, never pure black or white.
- One ember accent with a closed usage list; rarity is the point.
- Compact Operate-mode density: small rows, tight paddings, tabular numbers everywhere.
- Flat app surfaces with tonal layering and borders; shadows belong to floating overlays only.
- Status grammar fixed: ember = running, emerald = completed, red = failed, neutral = pending.

## Colors

Warm-tinted charcoal neutrals with a single amber-orange ember accent — the throat-to-coat gradient of a stone marten. All tokens live in `apps/web/src/global.css` under `@theme`: the `zinc-*` scale is remapped warm (hue ~66–85) so one change recolors every page, and the shadcn semantic vars (`primary`, `ring`, `accent`) point at ember.

### Primary
- **Ember** (oklch(0.7 0.16 55)): the single accent. Running reviews, links, primary actions, focus ring, active nav — and nothing else.

### Neutral
- **Warm Charcoal Background** (oklch(0.16 0.008 66)): page background; never pure black.
- **Warm Surface** (oklch(0.2 0.008 68)): cards, panels, list containers at 40–50% opacity over background.
- **Raised Surface** (oklch(0.27 0.008 70)): hovers, chips, dividers, borders — one warm step above surface.
- **Warm Foreground** (oklch(0.95 0.008 85)): primary text; never pure white.
- **Muted Text** (oklch(0.68 0.007 75)): secondary text, values in quiet contexts.
- **Quiet Label** (oklch(0.58 0.007 72)): section labels, stat labels, timestamps — always dimmer than the values they name.
- **Alarm Red** (oklch(0.55 0.16 25)): failure surfaces only (failed badges, needs-you panels, danger stats).

### Named Rules
**The One Ember Rule.** Ember appears only for running work, links, primary actions, the focus ring, and active nav. Never decoration, never success. The one recorded exemption is the ember logo square — the brand mark, not a UI state.
**The Two Greens Rule.** Emerald means run outcome (completed); the LiveBadge's green means SSE connection health. Distinct meanings, never interchangeable. Red means failed and zinc means pending in both grammars, unchanged.
**The Fixed Order Rule.** Chart series take hues in fixed order — ember first, then sky, amber, violet, zinc-as-neutral — and the order is load-bearing, not cosmetic: adjacent ramp entries were contrast-checked (worst adjacent pair ΔE 19.7 under deuteranopia). Never reorder without re-running the palette check. Past the end of the ramp, fold the rest into one "Other" bucket painted zinc; never wrap the index. (These are Tailwind class-string tokens in `components/charts/colors.ts`, not `@theme` tokens — documented here and in the sidecar, not the frontmatter.)
**The Severity Rule.** Finding severity is blocking = red, question = amber, nit = muted zinc — the same mapping in the review view, the stats mix bars, and the severity pills.

## Typography

**Display Font:** system-ui, -apple-system, sans-serif (with sans-serif fallback)
**Body Font:** system-ui, -apple-system, sans-serif (with sans-serif fallback)
**Label/Mono Font:** ui-monospace stack, for repo names, ids, costs, and CLI tokens like `/fouine`

**Character:** One system family carries everything; hierarchy comes from weight and scale, never from a second typeface. Numbers are always tabular so costs, durations, and counts line up in rows and strips.

### Hierarchy
- **Headline** (bold 700, 24px, tight tracking): page titles (`Dashboard`, `Agents`, `Settings`).
- **Title** (semibold 600, 18px, tight tracking): card titles in settings and settings-like surfaces.
- **Body** (regular 400, 14px, relaxed line-height): descriptions, list text, empty-state copy.
- **Label** (medium 500, 12px, wide tracking, uppercase): section labels (`Agents`, `Running now`, `Cost · last 30d`) and stat labels — always quiet (zinc-500), values stay brighter than labels.
- **Mono** (13–14px, repo names / ids / CLI tokens): identity strings, never prose.

### Named Rules
**The Tabular Rule.** Every number, cost, duration, and timestamp renders `tabular-nums` — stats, table cells, badges, time-ago stamps, no exceptions.
**The Quiet Label Rule.** Labels stay quiet (zinc-500 small-caps) and values stay brighter than their labels — stat values in zinc-100/ember-300/red-300 over zinc-500 names, section labels in zinc-500 over brighter content.

## Layout

Pages are single-column content blocks (`space-y-7`, 28px between sections) inside a shell: desktop left sidebar (w-56, 224px) plus scrolling main with roomy content padding (16px mobile, 32px desktop); mobile collapses to a top brand header and a fixed 8-item bottom tab bar with safe-area padding, and content carries bottom clearance for the bar. Chat is the deliberate exception — it owns its vertical space with an internal scroll viewport and a stuck composer instead of letting main scroll.

Sibling stats live in one bordered container with internal dividers (`divide-x`/`divide-y`), wrapping to two columns on small screens. List rows are compact (`px-4 py-2.5`) with a fixed-width badge cell (w-28, fits "completed") so every title block shares one left edge; metadata (trigger chip, model, cost, time-ago) right-aligns in fixed-width tabular columns and hides progressively on narrow screens. Panels pair a small-caps label with a bordered body (`space-y-2.5`, 10px label-to-body gap); the agents page spreads summary stats across the row on wide viewports and lets them wrap left on narrow ones.

### Named Rules
**The One Container Rule.** Sibling stats live in ONE bordered container with internal dividers, never repeated cards. No nested cards — a card inside a card is always wrong.

## Elevation & Depth

Depth comes from tonal layering and 1px warm borders, not shadows: background → translucent surface (`bg-zinc-900/40`) → raised hover (`bg-zinc-800/40`–`/60`) → chip (`bg-zinc-800/80`). Attention states tint the whole container instead of lifting it — the running panel is ember-bordered on an ember wash (`border-ember-800/50 bg-ember-950/25`), the needs-you panel red-bordered on a red wash.

Shadows exist but only on the floating layer: inputs carry a faint `shadow-sm`, popovers/dialogs/dropdowns/chart tooltips use `shadow-md`, dialogs and dropdown menus reach `shadow-lg`. App surfaces — cards, panels, rows, stat strips — are always shadow-free.

### Named Rules
**The Flat Field Rule.** App surfaces are flat at rest: tonal layering plus borders, no shadows. Shadows appear only on floating overlays (popover, dialog, dropdown, tooltip) and the small input inset — never on a card, panel, or row.

## Shapes

Gently rounded rects throughout: containers, cards, and panels at 8px (`rounded-lg`); buttons, inputs, chips, and nav items at 6px (`rounded-md`); status pills fully round (`rounded-full`); severity pills softly squared (bordered, 4–6px). Borders are hairline warm zinc, often translucent (`border-zinc-800/70`–`/80`); error and empty states use dashed borders to read as non-content. Geometry stays rectilinear — the only circles are status dots (6px) and the ember logo square (28px, 6px radius).

## Components

### Buttons
- **Shape:** gently rounded rects (6px radius), medium weight 14px text.
- **Primary:** ember fill (`bg-ember-500`) with near-black text, padding 8px 16px; hover lifts to ember-400. The only ember button — one primary action per surface.
- **Hover / Focus:** color transitions plus a subtle press scale (`active:scale-[0.96]`, disabled for reduced motion); focus is always the 2px ember ring with offset, enforced globally so the browser's blue outline never shows.
- **Secondary / Ghost / Tertiary:** outline (transparent, zinc-700 border, hover zinc-800 fill) for Retry/Re-run affordances; ghost (transparent, zinc-400 text) for nav-adjacent and icon actions; destructive (deep red fill) reserved for Stop.

### Chips
- **Style:** status pills are fully round with dot + label (`gap-1.5, px-2 py-0.5`, 12px medium, tabular): running (ember-950 wash, ember-300 text, breathing ember dot), completed (emerald wash), failed (red wash), pending (zinc wash), skipped (sky wash — deliberately muted, "nothing to see"). Severity pills share the shape without the dot: blocking (red border), question (amber border), nit (zinc).
- **State:** the running dot is the only breathing element on a quiet page (`fouine-pulse`, 1.4s); trigger/agent chips are flat muted rects (`bg-zinc-800/80`, 11px zinc-400), hidden on small screens.

### Cards / Containers
- **Corner Style:** gently rounded (8px).
- **Background:** translucent warm surface (`bg-zinc-900/40`–`/50`), settings cards slightly more solid with 24px padding.
- **Shadow Strategy:** none — see Elevation; borders do the work.
- **Border:** 1px warm zinc (`border-zinc-800`), ember- or red-tinted for the running and needs-you attention panels.
- **Internal Padding:** stats and agent sections `px-4 py-3.5`; rows `px-4 py-2.5`; settings cards `p-6`.

### Inputs / Fields
- **Style:** flat dark fields (`bg-zinc-900`, zinc-700 border, 6px radius, 36px height, 14px text, zinc-500 placeholder), faint inset shadow only.
- **Focus:** the global 2px ember ring — same as every other focusable, never a border-color shift alone.
- **Error / Disabled:** invalid selects take the destructive border; disabled controls halve opacity and drop pointer events.

### Navigation
- **Style:** sidebar items are 14px zinc-400 rows (`px-3 py-2`, 6px radius) with 16px icons; active is an ember fill + ember text (`bg-ember-950/40 text-ember-300`) — never a side stripe. Hover warms to zinc-100 on a zinc-800 wash. Mobile is an 8-column bottom tab bar (tiny 10px labels, ember active text, no fill). A `⌘K` command palette (pages, repos, reviews, actions) rides above both.

### List Rows
- **Style:** full-row links (`flex items-center gap-3 px-4 py-2.5`) with a fixed-width badge cell, truncating mono identity, and right-aligned tabular metadata; hover warms the row. Failed rows pair with an outline Retry button.
- **States:** loading renders shape-matched skeleton rows (same padding, pulsing zinc bars, reduced-motion-safe); empty renders a centered icon + guidance (`Inbox`, zinc-700) with the exact next action (`/fouine`); errors render a dashed-border box with a Retry button — never a bare message.

### Chart Panels
- **Style:** small-caps zinc-500 label over a bordered translucent body; empty windows render the inbox empty state (an empty range is a normal answer, not a broken chart), loading renders pulsing bars. Distribution mixes are 8px rounded bars with dot legends; the cost trend paints bars in translucent ember-500 warming to ember-400 on hover.

## Do's and Don'ts

### Do:
- **Do** keep ember rare — five closed uses (running, links, primary actions, focus ring, active nav) plus the logo mark.
- **Do** render every number, cost, and duration in `tabular-nums`.
- **Do** group sibling stats in one divided container, never repeated cards.
- **Do** keep labels quieter than values (zinc-500 labels under brighter content).
- **Do** use the fixed chart hue order (ember, sky, amber, violet, zinc-neutral) and fold overflow into "Other".
- **Do** give every loading, empty, and error state its designed shape — skeleton rows, inbox empty state, dashed error box with Retry.
- **Do** respect reduced motion: kill the pulse, ping, and press-scale.

### Don't:
- **Don't** use pure black (`#000`) or pure white (`#fff`) — the warmest dark is background, the brightest light is foreground.
- **Don't** use gradient text, glassmorphism, or side-stripe accents — active nav is a fill, not a border.
- **Don't** let ember double as success — completed is emerald, always.
- **Don't** confuse the two greens — emerald run outcome vs. emerald connection health are different meanings.
- **Don't** shadow a card, panel, or row — shadows belong to floating overlays only.
- **Don't** choreograph page loads — the only motion is liveness (pulse), loading (skeleton shimmer), and the session streaming ping.
- **Don't** nest cards or invent one-off token formats — reuse the zinc/ember scales and the shadcn semantic vars.
