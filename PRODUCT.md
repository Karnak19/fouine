# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developer (Basile) running a private fouine instance on own infra, checking review and agent run status on the dashboard between terminal and PR tab. The product is entirely self-hostable: anyone can run their own single-owner instance the same way. Team features are not on the roadmap today, but the product must not hard-code single-user assumptions.

Jobs to be done:

- Confirm a review ran (or is running) on a PR and read its findings.
- Flip auto-review on/off per repo, retry a failed review.
- Configure the provider key and the review prompt; check the connection.
- Follow the self-improvement loop: see what the improver proposed for `REVIEW.md`.
- Watch cost, latency and reliability over time (stats).
- Ask the built-in chat about review history.

## Product Purpose

fouine is a self-hosted AI code reviewer. A GitHub App webhook triggers a review per PR (opened / synchronize / reopened, or a `/fouine` comment), the backend bare-clones the repo, runs an OpenCode session per review with its own agent set, and posts the review back to GitHub. Beyond reviewing, agents close the loop: an improver deepens findings, a refiner tidies issues flagged `ready`, and an implementer carries a ready issue to a pull request. Success is a finding ending as merged code, not a comment.

## Positioning

Self-hosting and the closed agent loop are one claim, inseparable: running on your own infra with your own model keys is what makes it trustworthy enough to let agents write and push code autonomously. A hosted comment-bot could copy the loop; it could not truthfully copy the trust model.

## Operating Context

- Lives next to a terminal and a GitHub PR tab; the dashboard is glanced at between other work (dark always — see DESIGN.md).
- Deploys as one Bun container, optionally with an OpenCode sidecar (`docker-compose.yml` + `Dockerfile.opencode`); state accumulates in a single `DATA_DIR` volume (SQLite at WAL, cached bare clones, worktrees, runtime opencode config).
- GitHub is the only forge and the only trigger source; model access is the user's own OpenCode setup, never a bundled key.
- Dashboard-stored settings override env vars; per-repo prompt/model overrides global.

## Capabilities and Constraints

- Webhook-driven PR reviews plus comment-triggered re-reviews (`/fouine`, `/review` deprecated alias).
- Four agents: reviewer (`fouine`), improver (`fouine-improver`), refiner (`fouine-refiner`), implementer (`fouine-implementer`); every run is a `reviews` row distinguished by `trigger`. Per-agent model and prompt knobs (global + per-repo), `auto_ready` gating, `implement_label`.
- Dashboard (React SPA served by the backend): dashboard, repos, reviews + detail, agents, stats with charts, chat/build (OpenAI-compatible chat model), settings.
- One long-lived OpenCode server per process, one session per review — never a server per review; child (ephemeral port) or sidecar mode.
- Strict typecheck is the only gate (no ESLint/Prettier); tests are hermetic; SQLite has no migration framework — additive `addColumn` loops only; `ponytail:` comments mark deliberate shortcuts with named ceilings and are preserved.
- Deliberately undecided: team/multi-user features — leave room, decide later.

## Brand Commitments

- The name **fouine** (the stone marten) and the marten identity are binding; the warm "marten warm" visual world is recorded in DESIGN.md and owns all visual decisions.
- Voice: lazy-senior pragmatism — minimum code that works, dry and unpretentious, no marketing hype.

### Brand Personality

Warm craftsman. Three words: warm, precise, unhurried.

A fouine is a stone marten: warm brown coat, cream throat, small, quick,
curious. The UI carries that warmth into a developer tool without becoming
cute. Character comes from the palette and the care in details (tabular
numbers, exact alignment, honest status), not from illustration, mascots or
motion.

Voice: terse and plain, like a good CLI. Says what happened and what to do
next. No marketing adjectives, no "magic", no exclamation marks. Errors name
the cause and the fix.

Closest reference: Raycast. Warm dark surface, personality without noise,
dense but never cluttered, keyboard-friendly.

## Evidence on Hand

- Working product: webhook → review pipeline, four-agent loop, dashboard with live runs, stats charts, per-agent surface, settings; docs site (`apps/docs`, VitePress) covering architecture and data model.
- Absences future work must not fabricate: no marketing site, no testimonials, no benchmarks, no customer list.

## Product Principles

1. Close the loop: a finding should end as merged code, not a comment.
2. Self-hosted trust: the user's code, keys, and infra — the product never phones home.
3. Minimum code that works; every shortcut is deliberate and names its ceiling.
4. Boring, verifiable internals: strict typecheck as the only gate, hermetic tests, additive schema changes.
5. Solo by default, team-capable by design: no single-user assumptions in the data model or APIs.

## Anti-references

- Generic SaaS dashboard: hero-metric cards, gradient accents, identical card
  grids, a chart on every page for its own sake.
- Dev-tool blue: cyan or indigo on navy, the default observability look. fouine
  is warm charcoal and ember, on purpose.
- Enterprise admin: dense grey forms, a sidebar of twenty items, Bootstrap
  tables, modals for everything.
- AI-product glow: sparkles, purple gradients, framing the model as magic. The
  reviewer is a colleague that posts comments, not an oracle.

## Design Principles

1. **Status first.** Every screen answers "is it healthy, is it running, did
   it fail" before anything else. Status colors are unambiguous and never
   decorative: ember for running, green for done, red for failed.
2. **Warm, not cute.** The marten identity lives in tinted neutrals, the ember
   accent and typographic care. No mascots, no illustration, no whimsy in copy.
3. **Read like a terminal, feel like a room.** Dense, aligned, tabular data
   with generous breathing room around it. Numbers, costs and times always
   tabular-nums and right-aligned in columns.
4. **One accent, earned.** Ember appears only where attention or action is
   needed: running work, links, primary buttons, focus, active nav. If a page
   is more than a tenth ember, something is wrong.
5. **Inline over modal.** Configuration, retries and toggles happen in place.
   A modal is the last option, not the first.
6. **Say less, mean it.** Copy is short and specific. Labels are nouns, buttons
   are verbs, errors state cause and remedy.

## Accessibility & Inclusion

Best effort, no formal WCAG target. Standing rules: color is never the only
signal (status always has a label or icon), every interactive element is
keyboard reachable with a visible ember focus ring, `prefers-reduced-motion`
disables the only animation (the running pulse), text contrast on the warm
dark surface stays comfortably readable.
