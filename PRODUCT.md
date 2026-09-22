# Product

## Register

product

## Users

Developers who self-host fouine on their own server and point their GitHub App
at it. They are the repo owners or a small team, not an ops department. They
land on the dashboard from a PR tab or a terminal, usually with a question:
did the review run, what did it cost, why did it fail, what is the reviewer
learning about my repo. Sessions are short and frequent. The dashboard sits
next to GitHub and a terminal, on a wide screen, often in a dim room.

Jobs to be done:

- Confirm a review ran (or is running) on a PR and read its findings.
- Flip auto-review on/off per repo, retry a failed review.
- Configure the provider key and the review prompt; check the connection.
- Follow the self-improvement loop: see what the improver proposed for `REVIEW.md`.
- Watch cost, latency and reliability over time (stats).
- Ask the built-in chat about review history.

## Product Purpose

fouine is a self-hosted AI code reviewer: GitHub App webhook in, per-PR
worktree, one OpenCode agent pass, review posted back as inline comments and a
check run. The dashboard exists to make that pipeline observable and
configurable by one person without reading logs. Success is a developer who
trusts the reviewer enough to require its check on merge, and who can tell in
one glance whether it is healthy.

The dashboard serves the task. Design is judged by how fast the status of a
review or repo can be read, never by how impressive the page looks.

## Brand Personality

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
