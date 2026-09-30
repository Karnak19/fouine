---
name: fouine
description: Work with fouine, the self-hosted AI code reviewer (a GitHub App), on repositories it reviews. Use whenever a PR has reviews or comments from a fouine bot account (a footer starting "🦡 Addressing this with an agent?", a verdict line counting Blocking, Nits and Questions, a check run named "fouine"), when the user asks what fouine said, wants fouine's findings fixed or answered, wants to type a `/fouine` command (re-review, stop, skip nits, refine, implement), or wants to change how fouine reviews a repo (REVIEW.md, repo skills). Pairs with a generic PR skill such as github-pr for the rest of the PR loop.
---

# Working with fouine

fouine is a self-hosted AI code reviewer that runs as a GitHub App. It reviews every
non-draft PR on repos where it's enabled, and it can also refine and implement issues.
This skill covers what's specific to fouine. For the generic loop (opening the PR,
waiting for a bot, replying through `gh api`, triage), use a generic PR skill such as
`github-pr` if one is installed, and use this one on top of it.

## Recognise it

- **The account.** fouine posts as its GitHub App's bot user, `<app-slug>[bot]`. The
  slug depends on the install (for example `fouine-review`), so don't hardcode a name:
  find the login from a review that carries the footer below. `gh` sometimes shows the
  login without the `[bot]` suffix.
- **The footer.** Every review summary ends with:
  `🦡 Addressing this with an agent? After pushing fixes, reply to each finding thread
  you resolved (one line + commit SHA), or say why you didn't, then post a summary
  comment on the PR.` That footer is written for you. Do what it says.
- **The verdict line.** The summary ends with
  `Blocking: N · Nits: M · Questions: K · mergeable once <step, or "nothing">`.
- **The check run.** A check named `fouine` goes "in progress" when a review starts.
  It ends `success` when the review *ran*, `failure` when the run broke. It is not
  the verdict: a green `fouine` check can come with `REQUEST_CHANGES`. Read the review.

## Reading a review

Each finding has one tag:

| Tag | Means | What it asks of the author |
|---|---|---|
| `blocking` | Correctness bug, security issue, data-loss risk, broken contract | Fix it before merge |
| `nit` | Taste or style | Optional. Fix it if the fix is cheap |
| `question` | fouine isn't sure | Answer in the thread. Don't change code just to answer it |

The tags are recorded on fouine's side and summed in the verdict line. An inline
comment's text doesn't always say its own tag. Use the verdict counts and the review
state to know if anything is blocking, and read each comment to work out which one it is.

How the review state maps to findings:

- `REQUEST_CHANGES`: at least one finding is `blocking`.
- `APPROVE`: no findings at all. Also, when fouine's own last review was
  `CHANGES_REQUESTED`, the next one approves even with nits left, since only an approval
  clears that state on GitHub.
- `COMMENT`: nits and/or questions only. That still isn't an approval, which matters if
  branch protection or auto-merge needs fouine's approval (see "skip nits" below).

A comment that ends in a ```` ```suggestion ```` block holds the exact replacement
for the commented lines. You can apply it as it is (GitHub's "Commit suggestion" button,
or make the same edit locally), but check it against the code first like any other finding.

## Commands

Commands are PR or issue comments that start with `/fouine`. `/review` is an old alias
that still works. Always write `/fouine`.

The argument must match exactly (extra spaces around it are fine). Anything else after
`/fouine` counts as a plain `/fouine`. So `/fouine stopwatch` or `/fouine skip nitsy`
**start a full review**, they don't stop or skip anything.

On a **PR**:

| Command | Effect |
|---|---|
| `/fouine` | Full review of the current head, even if the diff hasn't changed since the last one |
| `/fouine stop` | Stops the running review. Reacts 👍 if it stopped something, 😕 if nothing was running |
| `/fouine skip nits` | Approves when only non-blocking findings are left. Rules below |

On an **issue**:

| Command | Effect |
|---|---|
| `/fouine refine` | fouine reads the issue and the code, then posts one comment with questions, acceptance criteria, likely files, size and risks. It may label the issue ready |
| `/fouine implement` | fouine writes the code for the issue and opens a PR |
| `/fouine stop` | Stops a running refine or implement |

On an issue, any other `/fouine ...` does nothing. On a repo where fouine is turned off,
no command does anything.

### `/fouine skip nits`

For when fouine's latest review has only nits or questions left and the author
has decided they aren't worth fixing. fouine doesn't run a model for this. It checks the
findings it already stored and, if the rules hold, posts an `APPROVE` pinned to that
exact commit. The approval says who skipped which findings. It refuses, with a reply
saying why, when:

- the person commenting isn't the PR author,
- a review is still running,
- fouine hasn't reviewed the current head commit (a push since the review counts),
- the latest review has a `blocking` finding or requested changes. Blocking findings
  can never be skipped,
- fouine can't confirm the findings' tags (an old review, or a review whose findings
  weren't stored). It won't guess.

If the head is already approved, it only reacts 😕. A 👍 means it approved.

It doesn't let a bot-opened PR merge on fouine's approval alone. That still needs a human.

## The loop on a PR fouine reviews

1. **Wait for the review of your head commit.** Pushing, opening, reopening or marking
   ready for review all start a review on their own. Drafts are skipped. Match on the
   head SHA, not on how many reviews there are.
2. **Check every finding against the code first.** fouine can be wrong. If a finding is
   wrong, reply with the evidence (the real line, the caller it missed) and leave the
   code alone.
3. **Fix every `blocking` finding.** If a finding names a whole kind of bug, look for
   the rest of it in your diff too.
4. **Decide on nits.** Fix the cheap ones. For the rest, reply with why you're leaving
   them. `/fouine skip nits` is for the PR author, so only type it when you are acting
   as the author and the human has agreed to skip.
5. **Answer each `question`** in its own thread.
6. **Push the fixes as new commits.** The push starts a new review by itself, so
   **don't also type `/fouine`**, which would start a second one. If a push doesn't
   change the diff (a plain rebase), fouine skips it and closes its check without a new
   review. That's the one time a manual `/fouine` makes sense.
7. **Reply to each thread you handled** (one line + commit SHA), then post one summary
   comment. This is what the footer asks for.

Replies are how fouine learns. On the next review it reads its earlier findings and your
replies, and it won't bring back something you explained as intended. A background job
also reads the humans' replies on recent PRs and proposes changes to the repo's
`REVIEW.md` as a PR from the branch `fouine/review-notes`. Skip-nits approvals feed that
job too. So when you disagree, say so in the thread with the reason. A finding you
ignore without a word teaches it nothing.

**Auto-merge.** A repo can turn on auto-merge. Then fouine merges a PR once its latest
review is `APPROVED` on the current head, no human has a standing `CHANGES_REQUESTED`,
checks pass, and (for bot-authored PRs) a human approved. Every push resets this to the
new commit. On such a repo, an approval (including skip nits) can lead straight to a
merge, so be deliberate about it.

## Steering fouine in a repo

- **`REVIEW.md` at the repo root.** fouine reads it from the PR's checkout and adds it
  to the reviewer's instructions. Put repo rules, known false alarms and "don't flag X"
  there. Since it's read from the PR's own checkout, a PR that edits `REVIEW.md` is
  reviewed with the edited version. Open `fouine/review-notes` PRs are fouine's own
  proposals: review them like any other PR.
- **Repo skills in `.claude/skills/`.** The reviewer picks up skills the repo ships
  there, straight from the checked-out PR.
- **Dashboard settings.** Admins can set a review prompt, a model and toggles
  (auto-merge, auto-refine, auto-implement) per repo in fouine's dashboard. You can't
  change those from the repo, so ask the user if they need changing.

## Guardrails

- **Never post a `/fouine` command, a thread reply or a summary comment for the user
  without their OK.** It goes out under their name. Draft it, show it, wait for a yes.
- **Don't spam re-reviews.** One push gives one review. Typing `/fouine` after a push
  pays for the same review twice.
- **Use `/fouine stop`** to cancel a review you started by mistake or that is
  reviewing a commit you're about to replace.
- **Cap the rounds.** If round three still has blocking findings, stop and bring it to
  the user instead of looping.
- **Never edit correct code just to quiet a finding.** Reply with the reason instead.
