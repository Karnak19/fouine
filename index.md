---
layout: home

hero:
  name: fouine
  text: Self-hosted AI code reviewer
  tagline: GitHub App + configurable agent. Runs on your server, reviews on your terms.
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/basilevernouillet/fouine

features:
  - icon: "\U0001F50D"
    title: Full codebase access
    details: Reviews use git worktrees, not just diffs. The agent explores the full codebase to give contextual feedback.
  - icon: "\U0001F916"
    title: Configurable AI agent
    details: Choose your model, write your own review prompt, set focus areas per repo. Full control over what gets reviewed and how.
  - icon: "\U0001F3D7\uFE0F"
    title: Self-hosted
    details: Runs on your infrastructure via Docker. Your code never leaves your server. One container, one volume, done.
  - icon: "\U0001F4DD"
    title: Inline comments
    details: Posts review summaries and line-level comments directly on your PRs, just like a human reviewer.
  - icon: "\U0001F4CA"
    title: Dashboard
    details: Web UI to manage repos, configure prompts, review history, and retry failed reviews.
  - icon: "\u26A1"
    title: Trigger on demand
    details: Automatic reviews on PR open/sync/reopen. Comment /review on any PR to trigger a manual review.
