# Merger

The merger clicks "merge" for you once fouine has approved a PR and CI is green — the last step of the review loop that otherwise sits waiting on a human.

It is off by default, and a setting alone never merges anything: a PR only merges after someone types `/fouine merge` on it.

## The six conditions

The merger checks all of the following, re-checked at the moment of merge, not just when you arm it:

1. **fouine's latest review is `APPROVED`.** Read straight from GitHub, not from fouine's own database — never `PENDING`, never a stale comment/changes-requested state.
2. **No human review is `CHANGES_REQUESTED`.** A human's later `APPROVED` clears their own earlier `CHANGES_REQUESTED`; fouine's approval never overrides one that's still standing.
3. **Every check run and commit status on the head SHA has completed**, and none concluded `failure`, `cancelled`, `timed_out` or `action_required`. `neutral` and `skipped` count as passing. If GitHub reports required status checks for the branch, only those count; otherwise every check on the commit does.
4. **The PR's head SHA still equals the SHA that was armed.** A new push disarms it (see below); this is the belt-and-braces re-check right before merging.
5. **The PR is not a draft.**
6. **The PR is `mergeable`** — GitHub's own computed field, polled briefly if it's still `null`.

If any condition is false, the merger does nothing and waits for the next relevant event (a new review, a check finishing, a new commit status). It never retries on a timer.

## Opting in

Two settings, global with a per-repo override — same pattern as the deny-test-commands toggle:

- **Auto-merge** — on/off. Off by default.
- **Merge method** — `merge`, `squash`, or `rebase`. Defaults to `squash`.

Both live in the dashboard's settings page and on each repo's detail page.

## Arming: `/fouine merge`

Opting a repo in only makes the merger *available*; a human still has to ask for it, per PR, every time:

1. Comment `/fouine merge` on the PR (the deprecated `/review merge` alias also works).
2. fouine checks you have `write`, `maintain`, or `admin` access to the repo (via GitHub's collaborator permission API). Anyone who can comment could otherwise type the command, so this is the gate.
3. If you're opted in and have access, the PR is armed against its current head SHA, and the merger evaluates it immediately.
4. **A new push disarms it.** fouine comments to say so; re-arm with `/fouine merge` again once you're ready.
5. An arm left untouched for 7 days is dropped automatically.

## The recap comment

Once merged, fouine posts one short comment on the PR: the merge method and commit SHA, who armed it and when, a link to the approving review, how many findings it raised and how many pushes it took to clear them, how many checks passed and whether required or all checks applied, fixer commits if any, and fouine's total cost on that PR. A transient error retrying the merge never produces a second recap — the same comment is edited in place.

## What it never does

- **Never merges without a per-PR `/fouine merge`.** The auto-merge setting only makes the command available; it never merges anything by itself.
- **Never merges over a standing human `CHANGES_REQUESTED`**, even with fouine's approval.
- **Never merges a draft PR**, an unmergeable PR, or a PR whose head has moved since it was armed.
- **Never deletes the head branch.** Use GitHub's own "automatically delete head branches" repo setting for that.
- **Never uses GitHub's native auto-merge (GraphQL) or merge queues** — those need branch protection with required checks, which many of the small repos this feature targets don't have.
