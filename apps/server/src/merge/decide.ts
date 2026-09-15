// Pure decision function for the merger (#117) — no GitHub calls, no DB, so it
// can be unit tested against plain objects. Convention: see shouldAutoRetry in
// ~/review/runner.ts.

export interface MergeReview {
  user: string;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENT | PENDING | DISMISSED
  submitted_at: string | null;
}

export interface MergeCheck {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required
}

export interface MergeStatus {
  name: string; // commit status "context"
  state: string; // pending | success | failure | error
}

export interface MergeState {
  armedSha: string;
  headSha: string;
  draft: boolean;
  mergeable: boolean | null;
  fouineReviews: MergeReview[];
  humanReviews: MergeReview[];
  checks: MergeCheck[];
  statuses: MergeStatus[];
  // Names of required checks/statuses from branch protection, or null when
  // unreadable (403/404) — null means "all checks on the head SHA count".
  requiredChecks: string[] | null;
}

export type MergeDecision = { ok: true } | { ok: false; reason: string; wait: boolean };

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function ok(): MergeDecision {
  return { ok: true };
}
function blocked(reason: string): MergeDecision {
  return { ok: false, reason, wait: false };
}
function waiting(reason: string): MergeDecision {
  return { ok: false, reason, wait: true };
}

// The latest verdict for a reviewer: GitHub keeps every submitted review, but a
// COMMENT-only review doesn't change a reviewer's standing approval/rejection —
// only their most recent APPROVED or CHANGES_REQUESTED does.
function latestVerdict(reviews: MergeReview[]): MergeReview | undefined {
  const verdicts = reviews.filter((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED");
  return verdicts.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "")).at(-1);
}

// Latest fouine review, PENDING ignored (fouine's own drafts/#97), by
// submitted_at. Exported for tests; evaluate.ts re-derives the same review
// with its GitHub-only fields (html_url, body) for the recap comment rather
// than narrowing through this signature.
export function latestFouineReview(reviews: MergeReview[]): MergeReview | undefined {
  return reviews
    .filter((r) => r.state !== "PENDING")
    .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
    .at(-1);
}

export function shouldMerge(state: MergeState): MergeDecision {
  // 6. Head must still be the armed SHA — a new push disarms elsewhere, but
  // re-checking here is the last line of defence against a race.
  if (state.headSha !== state.armedSha) {
    return blocked("PR head has moved since it was armed — re-run /fouine merge");
  }
  if (state.draft) return blocked("PR is a draft");
  if (state.mergeable === false) return blocked("PR is not mergeable (conflicts with base branch)");
  if (state.mergeable === null) return waiting("mergeable status not yet computed by GitHub");

  // 3. fouine's latest non-pending review must be APPROVED.
  const fouine = latestFouineReview(state.fouineReviews);
  if (!fouine) return blocked("fouine has not reviewed this PR yet");
  if (fouine.state !== "APPROVED") {
    return blocked(`fouine's latest review is ${fouine.state}, not APPROVED`);
  }

  // 4. No human's standing verdict may be CHANGES_REQUESTED.
  const humanByUser = new Map<string, MergeReview[]>();
  for (const r of state.humanReviews) {
    const list = humanByUser.get(r.user) ?? [];
    list.push(r);
    humanByUser.set(r.user, list);
  }
  for (const [user, reviews] of humanByUser) {
    const latest = latestVerdict(reviews);
    if (latest?.state === "CHANGES_REQUESTED") {
      return blocked(`@${user} requested changes and hasn't approved since`);
    }
  }

  // 5. Checks + commit statuses, filtered to required ones when known.
  const required = state.requiredChecks;
  const checks = required ? state.checks.filter((c) => required.includes(c.name)) : state.checks;
  const statuses = required ? state.statuses.filter((s) => required.includes(s.name)) : state.statuses;

  for (const c of checks) {
    if (c.status === "completed" && !PASSING_CONCLUSIONS.has(c.conclusion ?? "")) {
      return blocked(`check "${c.name}" concluded ${c.conclusion}`);
    }
  }
  for (const s of statuses) {
    if (s.state === "failure" || s.state === "error") {
      return blocked(`status "${s.name}" is ${s.state}`);
    }
  }
  const pendingCheck = checks.find((c) => c.status !== "completed");
  if (pendingCheck) return waiting(`check "${pendingCheck.name}" is still ${pendingCheck.status}`);
  const pendingStatus = statuses.find((s) => s.state === "pending");
  if (pendingStatus) return waiting(`status "${pendingStatus.name}" is still pending`);
  // A required check that hasn't reported at all (suite not created yet) is
  // absent from both lists — absence is not success.
  if (required) {
    const seen = new Set([...checks.map((c) => c.name), ...statuses.map((s) => s.name)]);
    const missing = required.find((n) => !seen.has(n));
    if (missing) return waiting(`required check "${missing}" has not reported yet`);
  }

  return ok();
}
