import { Elysia, t } from "elysia";
import type { Octokit } from "octokit";
import { config } from "~/config";
import { findings, repos, reviews, type ReviewRow } from "~/db";
import { getInstallationOctokit } from "~/github";
import { resolveAutoReady, resolveImplementLabel } from "~/settings";
import { publishFindings } from "~/server/events";
import {
  formatCiResults,
  type Annotation,
  type CheckRun,
} from "../../opencode-config/plugins/_ci_format";

// Shared secret for the loopback write-back channel the opencode post_* tools
// use to persist findings (POST /internal/reviews/:id/findings). The tools run
// in a subprocess this same process spawns, so a per-boot random token — passed
// down via FOUINE_INTERNAL_SECRET — is enough: it never leaves the host and
// needs no operator configuration. Regenerated each start; that's fine because
// no long-lived client holds it.
export const internalSecret = crypto.randomUUID();

// Where the subprocess reaches this server. Loopback only — the write-back is
// never meant to cross the machine boundary.
export const internalBaseUrl = `http://127.0.0.1:${config.port}`;

export const INTERNAL_SECRET_HEADER = "x-fouine-internal";

// ─── loopback proxy ─────────────────────────────────────────────────────────
//
// The review's custom tools no longer hold a GitHub token: they run in the
// opencode subprocess, which must never see a credential, and instead call
// these routes. fouine makes the GitHub call with the installation token it
// resolves in-process, and keeps the token out of the child entirely.
//
// The ONLY credential the caller carries is the opencode session id in the
// path. Everything else — owner/repo/PR/kind — is derived from the review row
// it resolves to, never trusted from the request body. The per-boot
// internalSecret is accepted as defence-in-depth (checked when present) but is
// deliberately NOT the boundary: a caller that only knows its session id still
// works.

// Which pipeline owns a session. A normal review's trigger is why it ran
// (opened/synchronize/reopened/command/retry) — all of those are a "review".
// The improver/refiner/implementer ride the same table with their own trigger,
// and each gets its own kind so the routes can gate what they may call.
export function kindOf(trigger: string | null): string {
  return trigger === "improve" || trigger === "refine" || trigger === "implement"
    ? trigger
    : "review";
}

export interface SessionInfo {
  review: ReviewRow;
  owner: string;
  repo: string;
  pr: number;
  kind: string;
}

export type SessionResolution =
  | { ok: true; session: SessionInfo }
  | { ok: false; status: 403 | 404; error: string };

// Resolve a session id to its review row. Unknown → 404; a row that is not
// still running → 403 (a finished/failed review must not be able to post).
export function resolveSession(sessionId: string): SessionResolution {
  const review = reviews.bySession.get({ $session: sessionId });
  if (!review) return { ok: false, status: 404, error: "unknown session" };
  if (review.status !== "running")
    return { ok: false, status: 403, error: `session is not running (${review.status})` };
  const [owner, repo] = review.repo_full_name.split("/");
  return {
    ok: true,
    session: { review, owner, repo, pr: review.pr_number, kind: kindOf(review.trigger) },
  };
}

type Authorized = { ok: true; session: SessionInfo } | { ok: false; status: number; error: string };

// Session resolution is the boundary; the shared secret only adds a check when
// the caller sends one. Never trust owner/repo/pr from the body — callers only
// ever hand us a session id.
function authorize(headers: Record<string, string | undefined>, sessionId: string): Authorized {
  const provided = headers[INTERNAL_SECRET_HEADER];
  if (provided && provided !== internalSecret) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return resolveSession(sessionId);
}

async function clientFor(repoFullName: string): Promise<Octokit> {
  const repo = repos.get.get({ $full_name: repoFullName });
  if (!repo) throw new Error(`repo ${repoFullName} is not registered`);
  return getInstallationOctokit(repo.installation_id);
}

interface StoredFinding {
  kind: "inline" | "summary" | "comment";
  body: string;
  event?: string;
  path?: string;
  line?: number;
  severity?: "blocking" | "nit" | "question";
  githubReviewId?: number;
  githubCommentId?: number;
}

// The dashboard's structured record of what was posted. Written straight from
// the proxy now that fouine itself makes the GitHub call — the plugin no longer
// has to report back after the fact.
function persistFindings(review: ReviewRow, list: StoredFinding[]): void {
  for (const f of list) {
    findings.insert.run({
      $review: review.id,
      $repo: review.repo_full_name,
      $pr: review.pr_number,
      $kind: f.kind,
      $severity: f.severity ?? null,
      $event: f.event ?? null,
      $path: f.path ?? null,
      $line: f.line ?? null,
      $body: f.body,
      $github_review_id: f.githubReviewId ?? null,
      $github_comment_id: f.githubCommentId ?? null,
    });
  }
  publishFindings(review.id, review.repo_full_name);
}

// Appended to every review body server-side, so the LLM can't drop it. Reaches
// an agent addressing the review at the moment it's reading it — the reliable
// place to ask for replies, vs. hoping the target repo's AGENTS.md/CLAUDE.md
// carries the rule.
const AGENT_FOOTER =
  "\n\n---\n_🦡 Addressing this with an agent? After pushing fixes, reply to each " +
  "finding thread you resolved (one line + commit SHA), or say why you didn't, then " +
  "post a summary comment on the PR._";

// ─── get_prior_reviews formatting ───────────────────────────────────────────
// Mirrors opencode-config/plugins/get_prior_reviews.ts byte-for-byte: the review
// prompt depends on this exact text.
interface GhReview {
  user?: { login?: string } | null;
  state: string;
  body?: string | null;
  submitted_at?: string | null;
  commit_id?: string | null;
}
interface GhComment {
  user?: { login?: string } | null;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  in_reply_to_id?: number | null;
  commit_id?: string | null;
  created_at?: string | null;
}

function clip(s?: string | null): string {
  const t = (s ?? "").trim();
  return t.length > 4000 ? `${t.slice(0, 4000)}\n…(truncated)` : t;
}

export function formatPriorReviews(
  reviewsArr: GhReview[],
  inline: GhComment[],
  issue: GhComment[],
): string {
  const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : "?");
  const out: string[] = [];

  if (reviewsArr.length) {
    out.push(`## Reviews (${reviewsArr.length})`);
    for (const r of reviewsArr) {
      out.push(
        `### ${r.user?.login ?? "?"} — ${r.state} @ ${short(r.commit_id)} (${r.submitted_at ?? ""})`,
        clip(r.body) || "_(no body)_",
      );
    }
  }

  if (inline.length) {
    out.push(`\n## Inline comments (${inline.length})`);
    for (const c of inline) {
      const reply = c.in_reply_to_id ? " [reply]" : "";
      out.push(
        `- ${c.user?.login ?? "?"} on ${c.path}:${c.line ?? c.original_line ?? "?"} @ ${short(c.commit_id)}${reply}: ${clip(c.body)}`,
      );
    }
  }

  if (issue.length) {
    out.push(`\n## PR comments (${issue.length})`);
    for (const c of issue) {
      out.push(`- ${c.user?.login ?? "?"} (${c.created_at ?? ""}): ${clip(c.body)}`);
    }
  }

  return out.length ? out.join("\n") : "No prior reviews or comments on this PR.";
}

// ─── propose_review_notes constants ─────────────────────────────────────────
// The improver's only write path. The agent hands over content; fouine does the
// GitHub writes programmatically (branch + commit + PR), so the agent never
// holds free-form write access — and the human merging the PR is the gate on
// what actually reaches future reviews.
const NOTES_BRANCH = "fouine/review-notes";

const PR_FOOTER =
  "\n\n---\n_🦡 Proposed by fouine's outer-loop improver from human feedback on recent " +
  "review threads. Merging updates the guidance injected into every future review; " +
  "close to reject._";

function errText(err: unknown): string {
  return String((err as Error)?.message ?? err);
}

export const internalRoutes = new Elysia({ prefix: "/internal" })
  // Resolve a session to the repo/PR/kind it owns. The tools call this first.
  .get("/sessions/:sid/context", ({ params, headers, set }) => {
    const auth = authorize(headers, params.sid);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const { review, owner, repo, pr, kind } = auth.session;
    return { kind, owner, repo, pr, reviewId: review.id };
  })

  // Post a formal PR review (summary + inline comments). Mirrors post_review.ts.
  .post(
    "/sessions/:sid/review",
    async ({ params, headers, body, set }) => {
      const auth = authorize(headers, params.sid);
      if (!auth.ok) {
        set.status = auth.status;
        return { error: auth.error };
      }
      const { review, owner, repo, pr, kind } = auth.session;
      if (kind !== "review") {
        set.status = 403;
        return { error: `session kind '${kind}' cannot post a review` };
      }
      const summary = body.summary ?? "";
      const event = body.event ?? "COMMENT";
      const comments = (body.comments ?? []).map((c) => {
        const side = c.side ?? "RIGHT";
        const line = c.line ?? 0;
        return {
          path: c.path ?? "",
          body: c.body ?? "",
          side,
          line,
          // Multi-line comments take start_line+line; a single-line one takes
          // just line.
          ...(c.startLine ? { start_line: c.startLine, line } : {}),
        };
      });
      try {
        const octokit = await clientFor(review.repo_full_name);
        const res = await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: pr,
          body: summary + AGENT_FOOTER,
          event,
          comments,
        });
        const id = res.data.id;
        persistFindings(review, [
          { kind: "summary", event, body: summary, githubReviewId: id },
          ...(body.comments ?? []).map((c) => ({
            kind: "inline" as const,
            path: c.path ?? "",
            line: c.line ?? 0,
            severity: c.severity ?? "nit",
            body: c.body ?? "",
            githubReviewId: id,
          })),
        ]);
        return { text: `Review posted (id ${id}) with ${comments.length} inline comment(s).` };
      } catch (err) {
        set.status = 502;
        return { error: errText(err) };
      }
    },
    {
      body: t.Object({
        summary: t.Optional(t.String()),
        event: t.Optional(
          t.Union([t.Literal("COMMENT"), t.Literal("APPROVE"), t.Literal("REQUEST_CHANGES")]),
        ),
        comments: t.Optional(
          t.Array(
            t.Object({
              path: t.Optional(t.String()),
              line: t.Optional(t.Number()),
              startLine: t.Optional(t.Number()),
              side: t.Optional(t.Union([t.Literal("LEFT"), t.Literal("RIGHT")])),
              severity: t.Optional(
                t.Union([t.Literal("blocking"), t.Literal("nit"), t.Literal("question")]),
              ),
              body: t.Optional(t.String()),
            }),
          ),
        ),
      }),
    },
  )

  // Post a plain issue/PR comment. Mirrors post_comment.ts.
  .post(
    "/sessions/:sid/comment",
    async ({ params, headers, body, set }) => {
      const auth = authorize(headers, params.sid);
      if (!auth.ok) {
        set.status = auth.status;
        return { error: auth.error };
      }
      const { review, owner, repo, pr } = auth.session;
      if (pr <= 0) {
        set.status = 403;
        return { error: "session has no PR/issue number to comment on" };
      }
      const text = body.body ?? "";
      try {
        const octokit = await clientFor(review.repo_full_name);
        const res = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pr,
          body: text,
        });
        persistFindings(review, [{ kind: "comment", body: text, githubCommentId: res.data.id }]);
        return { text: `Comment posted (id ${res.data.id}).` };
      } catch (err) {
        set.status = 502;
        return { error: errText(err) };
      }
    },
    { body: t.Object({ body: t.String() }) },
  )

  // A PR's prior reviews and comments. Mirrors get_prior_reviews.ts; `pr`
  // defaults to the session's own PR (the improver, whose row carries 0, passes
  // one explicitly).
  .get("/sessions/:sid/prior-reviews", async ({ params, headers, query, set }) => {
    const auth = authorize(headers, params.sid);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const { review, owner, repo, pr } = auth.session;
    const requested = query.pr === undefined ? pr : Number(query.pr);
    if (!Number.isInteger(requested) || requested <= 0) {
      set.status = 400;
      return { error: "no PR number: pass ?pr= or run in a PR-bound review" };
    }
    try {
      const octokit = await clientFor(review.repo_full_name);
      const [reviewsRes, inlineRes, issueRes] = await Promise.all([
        octokit.rest.pulls.listReviews({ owner, repo, pull_number: requested, per_page: 100 }),
        octokit.rest.pulls.listReviewComments({ owner, repo, pull_number: requested, per_page: 100 }),
        octokit.rest.issues.listComments({ owner, repo, issue_number: requested, per_page: 100 }),
      ]);
      return {
        text: formatPriorReviews(
          reviewsRes.data as unknown as GhReview[],
          inlineRes.data as unknown as GhComment[],
          issueRes.data as unknown as GhComment[],
        ),
      };
    } catch (err) {
      set.status = 502;
      return { error: errText(err) };
    }
  })

  // Check runs + annotations for the session's head commit. Mirrors
  // get_ci_results.ts, reusing its pure formatter so the tool output is unchanged.
  .get("/sessions/:sid/ci", async ({ params, headers, set }) => {
    const auth = authorize(headers, params.sid);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const { review, owner, repo, pr, kind } = auth.session;
    if (kind !== "review") {
      set.status = 403;
      return { error: `session kind '${kind}' has no PR head commit to read CI for` };
    }
    try {
      const octokit = await clientFor(review.repo_full_name);
      const prData = await octokit.rest.pulls.get({ owner, repo, pull_number: pr });
      const sha = prData.data.head?.sha;
      if (!sha) throw new Error(`could not resolve head SHA for PR #${pr}`);

      const checks = await octokit.rest.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
      // Our own check run reports the review itself; including it is noise at
      // best and self-referential confusion at worst.
      const runs: Array<CheckRun & { id: number }> = (checks.data.check_runs ?? [])
        .filter((r) => !/^fouine/i.test(r.name))
        .map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          output: r.output
            ? { title: r.output.title, annotations_count: r.output.annotations_count }
            : null,
        }));

      const withAnnotations = runs.filter((r) => (r.output?.annotations_count ?? 0) > 0);
      const fetched = await Promise.all(
        withAnnotations.map(async (r) => {
          const list = await octokit.rest.checks.listAnnotations({
            owner,
            repo,
            check_run_id: r.id,
            per_page: 100,
          });
          return [r.name, list.data as unknown as Annotation[]] as const;
        }),
      );

      return { text: formatCiResults(sha, runs, new Map(fetched)) };
    } catch (err) {
      set.status = 502;
      return { error: errText(err) };
    }
  })

  // Add the repo's implement-ready label. The label and the auto-ready opt-in
  // are resolved server-side now (they used to ride FOUINE_READY_LABEL).
  .post(
    "/sessions/:sid/ready-label",
    async ({ params, headers, body, set }) => {
      const auth = authorize(headers, params.sid);
      if (!auth.ok) {
        set.status = auth.status;
        return { error: auth.error };
      }
      const { review, owner, repo, pr, kind } = auth.session;
      if (kind !== "refine") {
        set.status = 403;
        return { error: `session kind '${kind}' cannot label issues ready` };
      }
      if (pr <= 0) {
        set.status = 403;
        return { error: "session has no issue number to label" };
      }
      const repoRow = repos.get.get({ $full_name: review.repo_full_name });
      if (!repoRow) {
        set.status = 404;
        return { error: "repo not registered" };
      }
      // Unset = the repo has auto_ready off. Not an error: the verdict is still
      // useful in the comment, a human just has to add the label themselves.
      if (!resolveAutoReady(repoRow.auto_ready)) {
        return {
          text: "Auto-ready is off for this repository: no label added. A human will add the ready label.",
        };
      }
      const label = resolveImplementLabel(repoRow.implement_label);
      try {
        const octokit = await clientFor(review.repo_full_name);
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pr,
          labels: [label],
        });
        const suffix = body.reason ? ` (${body.reason})` : "";
        return { text: `Issue labelled "${label}"; the implementer will pick it up.${suffix}` };
      } catch (err) {
        set.status = 502;
        return { error: errText(err) };
      }
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
      }),
    },
  )

  // Propose an updated REVIEW.md via a PR. Mirrors propose_review_notes.ts.
  .post(
    "/sessions/:sid/proposal",
    async ({ params, headers, body, set }) => {
      const auth = authorize(headers, params.sid);
      if (!auth.ok) {
        set.status = auth.status;
        return { error: auth.error };
      }
      const { review, owner, repo, kind } = auth.session;
      if (kind !== "improve") {
        set.status = 403;
        return { error: `session kind '${kind}' cannot open a review-notes proposal` };
      }
      const content = body.content;
      const summary = body.summary;
      try {
        const octokit = await clientFor(review.repo_full_name);

        const repoInfo = await octokit.rest.repos.get({ owner, repo });
        const defaultBranch = repoInfo.data.default_branch;

        const open = await octokit.rest.pulls.list({
          owner,
          repo,
          head: `${owner}:${NOTES_BRANCH}`,
          state: "open",
        });

        // With a proposal still open, the branch is live review state a human
        // hasn't merged yet: commit on top of it. Only when nothing is open do
        // we reset the branch onto the default head (create if missing), so a
        // stale branch left behind by a merged/closed PR can't stack commits
        // forever.
        if (!open.data.length) {
          const head = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${defaultBranch}`,
          });
          const sha = head.data.object.sha;
          try {
            await octokit.rest.git.createRef({
              owner,
              repo,
              ref: `refs/heads/${NOTES_BRANCH}`,
              sha,
            });
          } catch (err) {
            if ((err as { status?: number }).status !== 422) throw err;
            await octokit.rest.git.updateRef({
              owner,
              repo,
              ref: `heads/${NOTES_BRANCH}`,
              sha,
              force: true,
            });
          }
        }

        // Existing file sha on the branch, if any (contents PUT requires it to
        // update).
        const existing = await octokit.rest.repos
          .getContent({ owner, repo, path: "REVIEW.md", ref: NOTES_BRANCH })
          .catch(() => undefined);
        const sha =
          existing && !Array.isArray(existing.data) ? existing.data.sha : undefined;

        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: "REVIEW.md",
          message: "chore: update review notes from review-thread feedback",
          content: Buffer.from(content, "utf8").toString("base64"),
          branch: NOTES_BRANCH,
          ...(sha ? { sha } : {}),
        });

        const prBody = summary + PR_FOOTER;
        if (open.data.length) {
          await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: open.data[0].number,
            body: prBody,
          });
          return { text: `Updated existing proposal PR: ${open.data[0].html_url}` };
        }
        const pr = await octokit.rest.pulls.create({
          owner,
          repo,
          title: "fouine: update REVIEW.md from review feedback",
          head: NOTES_BRANCH,
          base: defaultBranch,
          body: prBody,
        });
        return { text: `Opened proposal PR: ${pr.data.html_url}` };
      } catch (err) {
        set.status = 502;
        return { error: errText(err) };
      }
    },
    { body: t.Object({ content: t.String(), summary: t.String() }) },
  )

  // Legacy findings write-back, kept for any pre-proxy plugin still calling it.
  // Guarded by the per-boot shared secret (best-effort by design), off the /api
  // OAuth gate because it isn't a browser caller.
  .post(
    "/reviews/:id/findings",
    ({ params, headers, body, set }) => {
      if (headers[INTERNAL_SECRET_HEADER] !== internalSecret) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const reviewId = Number(params.id);
      const review = reviews.byId.get({ $id: reviewId });
      if (!review) {
        set.status = 404;
        return { error: "unknown review" };
      }
      persistFindings(review, body.findings);
      return { ok: true, stored: body.findings.length };
    },
    {
      body: t.Object({
        findings: t.Array(
          t.Object({
            kind: t.Union([t.Literal("inline"), t.Literal("summary"), t.Literal("comment")]),
            severity: t.Optional(
              t.Union([t.Literal("blocking"), t.Literal("nit"), t.Literal("question")]),
            ),
            event: t.Optional(t.String()),
            path: t.Optional(t.String()),
            line: t.Optional(t.Number()),
            body: t.String(),
            githubReviewId: t.Optional(t.Number()),
            githubCommentId: t.Optional(t.Number()),
          }),
        ),
      }),
    },
  );
