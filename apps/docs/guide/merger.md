# Merger

The merger clicks "merge" for you once fouine has approved a PR, CI is green, and its own risk check says the change is safe to ship unattended — the last step of the review loop that otherwise sits waiting on a human.

It is off by default. Once a repo opts in, every non-draft PR on that repo merges itself once it's low-risk — there's nothing to type, nothing to remember.

## The five conditions

The merger checks all of the following, re-checked at the moment of merge, not just when a PR is armed:

1. **fouine's latest review on the armed head SHA is `APPROVED`.** Read straight from GitHub, not from fouine's own database — never `PENDING`, never a stale comment/changes-requested state, and never a review left on a commit that was later superseded by a push.
2. **No human review is `CHANGES_REQUESTED`.** A human's later `APPROVED` clears their own earlier `CHANGES_REQUESTED`; fouine's approval never overrides one that's still standing.
3. **Every check run and commit status on the head SHA has completed**, and none concluded `failure`, `cancelled`, `timed_out` or `action_required`. `neutral` and `skipped` count as passing. If GitHub reports required status checks for the branch, only those count; otherwise every check on the commit does.
4. **The PR's head SHA still equals the SHA that was armed.** A new push re-arms it against the new commit (see below); this is the belt-and-braces re-check right before merging.
5. **The PR is `mergeable`** — GitHub's own computed field, polled briefly if it's still `null`.

If any condition is false, the merger does nothing and waits for the next relevant event (a new review, a check finishing, a new commit status). It never retries on a timer.

## The risk gate

Once all five conditions above are green, the merger makes one more call before actually merging: a cheap LLM call (the same OpenAI-compatible model the dashboard's chat feature uses, not the review model) judges the PR's diff, title/description, fouine's approving review, and its findings count, and classifies the change as **low** or **critical** risk.

Critical covers things like auth/permissions/session handling, secrets or credentials, database schema or data migrations, payments/billing, infra/deploy/CI config, security-sensitive input handling, public API or breaking-contract changes, large cross-cutting refactors, and deletion of significant code or data. Everything else — docs, tests, copy, small contained fixes, styling, well-covered internal refactors — is low risk. When the model is unsure, it always says critical.

- **Low risk** merges exactly as before, and the recap comment gets one extra line with the model's reasoning.
- **Critical risk holds**: the merger posts a comment explaining why, and disarms the PR — it does **not** merge, and it does **not** wait for a human approval to unlock itself. A human clicks GitHub's own Merge button when they're happy. A later push re-arms the PR and the whole pipeline, risk gate included, runs again from scratch.
- If the diff can't be fetched, is too large to send (~200KB), the model call fails, or its output doesn't parse, the merger fails closed and treats it as critical — an assessment problem always means "hold", never "merge anyway".

## Opting in

Two settings, global with a per-repo override — same pattern as the deny-test-commands toggle:

- **Auto-merge** — on/off. Off by default.
- **Merge method** — `merge`, `squash`, or `rebase`. Defaults to `squash`.

Both live in the dashboard's settings page and on each repo's detail page.

## Arming: automatic

Once a repo is opted in, fouine arms every non-draft PR against its current head SHA the moment it's opened, pushed to, reopened, or marked ready for review. There's no command:

1. Open a PR (or push to one) on an opted-in repo — it's armed immediately.
2. The merger evaluates it whenever something relevant happens: fouine's review lands, a check finishes, a commit status reports.
3. **A new push re-arms it against the new commit** — no disarm step, no comment, it just moves to the new SHA.
4. **Draft PRs are never armed.** Marking a PR ready for review arms it.
5. An arm left untouched for 7 days is dropped automatically.

## The recap comment

Once merged, fouine posts one short comment on the PR: the merge method and commit SHA, a link to the approving review, how many findings it raised and how many pushes it took to clear them, how many checks passed and whether required or all checks applied, fixer commits if any, and fouine's total cost on that PR. A retried evaluation never posts a second recap: once the PR shows as merged, evaluation short-circuits before ever reaching the recap step.

## What it never does

- **Never merges a repo that hasn't opted into auto-merge.** The setting is what turns this on at all.
- **Never merges over a standing human `CHANGES_REQUESTED`**, even with fouine's approval.
- **Never merges a draft PR**, an unmergeable PR, or a PR whose head has moved since it was armed.
- **Never deletes the head branch.** Use GitHub's own "automatically delete head branches" repo setting for that.
- **Never uses GitHub's native auto-merge (GraphQL) or merge queues** — those need branch protection with required checks, which many of the small repos this feature targets don't have.
