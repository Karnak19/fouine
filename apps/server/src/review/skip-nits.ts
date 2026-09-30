// `/fouine skip nits` (#159): the PR author waves off the non-blocking findings
// of fouine's latest review on the current head, and fouine posts an APPROVE
// pinned to that commit. No model run — the server decides from the findings it
// already stored. Split like the merger: a pure decision (decideSkipNits, unit
// tested against plain objects) and a thin Effect pipeline around it that does
// the GitHub reads/writes (skipNitsPipeline). webhook.ts only wires it up.

import { Effect } from "effect";
import { findings, nitDismissals, type FindingRow } from "~/db";
import { GitHubService } from "~/effect/github";
import { latestFouineReview } from "~/merge/decide";
import { log } from "~/server/log";

// One of fouine's own GitHub reviews on the PR, already filtered to the bot
// login (the caller does that, like evaluate.ts does for the merger).
export interface SkipNitsReview {
  id: number;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | PENDING | DISMISSED
  submitted_at: string | null;
  commit_id: string | null;
}

export interface SkipNitsInput {
  commenter: string | undefined;
  prAuthor: string | null;
  headSha: string;
  reviewRunning: boolean;
  fouineReviews: SkipNitsReview[];
  // Every findings row stored for the latest fouine review on the head (by its
  // github_review_id). Looked up by the caller once it knows which review that
  // is — see skipNitsTarget.
  findings: FindingRow[];
}

export type SkipNitsRefusal =
  | "not-author"
  | "review-running"
  | "no-review"
  | "blocking"
  | "unverifiable";

export type SkipNitsDecision =
  | { kind: "approve"; review: SkipNitsReview; skipped: FindingRow[] }
  | { kind: "already-approved" }
  | { kind: "refuse"; reason: SkipNitsRefusal; message: string };

// The review `/fouine skip nits` is about: fouine's latest non-PENDING review
// on the current head. Pinned to the head so a review of an older commit can
// never be skipped into an approval of a newer one.
export function skipNitsTarget(
  reviews: SkipNitsReview[],
  headSha: string,
): SkipNitsReview | undefined {
  return latestFouineReview(reviews.filter((r) => r.commit_id === headSha));
}

// Pure decision — no GitHub, no DB. The order matters only for which reason the
// author reads first; every refusal posts nothing but a reply.
export function decideSkipNits(input: SkipNitsInput): SkipNitsDecision {
  if (!input.commenter || !input.prAuthor || input.commenter !== input.prAuthor) {
    return refuse(
      "not-author",
      input.prAuthor
        ? `Only the PR author (@${input.prAuthor}) can skip nits.`
        : "Only the PR author can skip nits.",
    );
  }
  if (input.reviewRunning) {
    return refuse(
      "review-running",
      "A fouine review is still running on this PR, and its result will replace the one you'd be skipping. Try again once it's posted.",
    );
  }
  const review = skipNitsTarget(input.fouineReviews, input.headSha);
  if (!review) {
    return refuse(
      "no-review",
      `fouine hasn't reviewed the current head (\`${input.headSha.slice(0, 7)}\`), so there's nothing to skip. Comment \`/fouine\` to get a review first.`,
    );
  }
  if (review.state === "APPROVED") return { kind: "already-approved" };
  if (review.state === "CHANGES_REQUESTED") {
    return refuse(
      "blocking",
      "fouine's latest review requested changes. Blocking findings can't be skipped: fix them and push.",
    );
  }
  const rows = input.findings.filter((f) => f.github_review_id === review.id);
  const inline = rows.filter((f) => f.kind === "inline");
  const blocking = inline.filter((f) => f.severity === "blocking");
  if (blocking.length > 0) {
    return refuse(
      "blocking",
      `fouine's latest review has ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"}. Those can't be skipped: fix them and push.`,
    );
  }
  // Never read a missing severity as "nit": no rows at all (review posted
  // before findings were stored, or never persisted) or an untagged inline row
  // means we can't prove there was nothing blocking.
  if (rows.length === 0 || inline.some((f) => f.severity == null)) {
    return refuse(
      "unverifiable",
      "I can't verify the severities of fouine's latest review, so I won't approve on its behalf. Comment `/fouine` for a fresh review, then try again.",
    );
  }
  return { kind: "approve", review, skipped: inline };
}

function refuse(reason: SkipNitsRefusal, message: string): SkipNitsDecision {
  return { kind: "refuse", reason, message };
}

const MAX_LISTED = 20;

// The approval body. This is what the improver reads through
// get_prior_reviews, so it says plainly what happened and what was waved off.
export function renderSkipNitsApproval(opts: {
  author: string;
  headSha: string;
  reviewUrl: string | undefined;
  skipped: FindingRow[];
}): string {
  const review = opts.reviewUrl ? `[fouine's review](${opts.reviewUrl})` : "fouine's review";
  const lines = [
    `Approved via \`/fouine skip nits\` by @${opts.author}. They read the non-blocking findings of ${review} on \`${opts.headSha.slice(0, 7)}\` and chose not to address them. Nothing blocking was found.`,
  ];
  if (opts.skipped.length === 0) {
    lines.push("", "_No inline findings were skipped._");
  } else {
    lines.push("", `Skipped findings (${opts.skipped.length}):`);
    for (const f of opts.skipped.slice(0, MAX_LISTED)) {
      const first = (f.body.split("\n").find((l) => l.trim()) ?? "").trim();
      const clipped = first.length > 160 ? `${first.slice(0, 157)}…` : first;
      lines.push(`- \`${f.path ?? "?"}:${f.line ?? "?"}\` (${f.severity}) ${clipped}`);
    }
    if (opts.skipped.length > MAX_LISTED) {
      lines.push(`- …and ${opts.skipped.length - MAX_LISTED} more`);
    }
  }
  return lines.join("\n");
}

export interface SkipNitsTarget {
  repoFullName: string;
  prNumber: number;
  installationId: number;
  commenter: string | undefined;
}

// Runs the command end to end and returns the reaction to put on the comment:
// "+1" when fouine approved, "confused" for everything else (a refusal, which
// also gets a reply, "already approved", or a GitHub failure).
export function skipNitsPipeline(
  target: SkipNitsTarget,
  reviewRunning: () => boolean,
): Effect.Effect<"+1" | "confused", never, GitHubService> {
  return Effect.gen(function* () {
    const gh = yield* GitHubService;
    const { repoFullName, prNumber } = target;
    const [owner, repo] = repoFullName.split("/");
    const fail = (step: string) => (cause: unknown) =>
      Effect.sync(() => {
        log.warn("skip nits: GitHub call failed", {
          repo: repoFullName,
          pr: prNumber,
          step,
          error: String(cause),
        });
        return undefined;
      });

    const octokit = yield* gh
      .installationClient(target.installationId)
      .pipe(Effect.catchAll(fail("installationClient")));
    if (!octokit) return "confused";
    const pull = yield* gh
      .getPull(octokit, owner, repo, prNumber)
      .pipe(Effect.catchAll(fail("getPull")));
    if (!pull) return "confused";
    const botLogin = yield* gh.botLogin().pipe(Effect.catchAll(fail("botLogin")));
    if (!botLogin) return "confused";
    const all = yield* gh
      .listReviews(octokit, owner, repo, prNumber)
      .pipe(Effect.catchAll(fail("listReviews")));
    if (!all) return "confused";

    const fouineRaw = all.filter((r) => r.user === botLogin);
    const fouineReviews: SkipNitsReview[] = fouineRaw.map((r) => ({
      id: r.id,
      state: r.state,
      submitted_at: r.submitted_at,
      commit_id: r.commit_id,
    }));
    const latest = skipNitsTarget(fouineReviews, pull.headSha);
    const rows = latest
      ? yield* Effect.sync(() =>
          findings.byGithubReview.all({ $repo: repoFullName, $github_review_id: latest.id }),
        )
      : [];

    const decision = decideSkipNits({
      commenter: target.commenter,
      prAuthor: pull.author,
      headSha: pull.headSha,
      reviewRunning: reviewRunning(),
      fouineReviews,
      findings: rows,
    });

    if (decision.kind === "already-approved") {
      log.info("skip nits: already approved", { repo: repoFullName, pr: prNumber });
      return "confused";
    }
    if (decision.kind === "refuse") {
      log.info("skip nits refused", {
        repo: repoFullName,
        pr: prNumber,
        reason: decision.reason,
        commenter: target.commenter,
      });
      yield* gh.createIssueComment(octokit, owner, repo, prNumber, `🦡 ${decision.message}`);
      return "confused";
    }

    const author = target.commenter!; // decision.kind === "approve" implies commenter === author
    const reviewed = decision.review.commit_id!; // skipNitsTarget only returns head-sha reviews
    const body = renderSkipNitsApproval({
      author,
      headSha: reviewed,
      reviewUrl: fouineRaw.find((r) => r.id === decision.review.id)?.html_url,
      skipped: decision.skipped,
    });
    const approvalId = yield* gh
      .approvePull(octokit, owner, repo, prNumber, reviewed, body)
      .pipe(Effect.catchAll(fail("approvePull")));
    if (approvalId === undefined) return "confused";

    yield* Effect.sync(() =>
      nitDismissals.insert.run({
        $repo: repoFullName,
        $pr: prNumber,
        $review: rows[0]?.review_id ?? null,
        $github_review_id: decision.review.id,
        $approval_github_review_id: approvalId,
        $sha: reviewed,
        $by: author,
      }),
    );
    log.info("skip nits: approved", {
      repo: repoFullName,
      pr: prNumber,
      sha: reviewed,
      skipped: decision.skipped.length,
      by: author,
    });
    return "+1";
  });
}
