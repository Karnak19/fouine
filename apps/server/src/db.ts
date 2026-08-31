import { Database } from "bun:sqlite";
import { config } from "~/config";
import type {
  DailyStatsRow,
  FindingRow,
  FindingsDailyRow,
  ModelStatsRow,
  ProjectStatsRow,
  ReliabilityRow,
  RepoRow,
  ReviewRow,
  SeverityStatsRow,
  SkillMetaRow,
  TopCostRow,
  TopFileRow,
  TriggerStatsRow,
} from "@fouine/shared";

// The row shapes the dashboard also sees live in @fouine/shared — re-exported
// here so `~/db` stays the server's single import point for them.
export type {
  DailyStatsRow,
  FindingRow,
  FindingsDailyRow,
  ModelStatsRow,
  ProjectStatsRow,
  ReliabilityRow,
  RepoRow,
  ReviewRow,
  SeverityStatsRow,
  SkillMetaRow,
  TopCostRow,
  TopFileRow,
  TriggerStatsRow,
} from "@fouine/shared";

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    full_name       TEXT PRIMARY KEY,
    installation_id INTEGER NOT NULL,
    prompt          TEXT,
    model           TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_full_name  TEXT NOT NULL REFERENCES repos(full_name),
    pr_number       INTEGER NOT NULL,
    session_id      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_repo_pr
    ON reviews(repo_full_name, pr_number);

  -- One row per posted finding, written back by the opencode post_* tools right
  -- after they hit GitHub (see /internal/reviews/:id/findings). This is the
  -- structured record of what fouine actually flagged — the transcript has the
  -- reasoning, this has the verdict — so the dashboard can render the review and
  -- trend findings (volume, severity mix) the way it already trends cost/tokens.
  --   kind: 'inline' (pinned finding) | 'summary' (post_review body) | 'comment' (post_comment)
  --   severity: the finding's tag — 'blocking' | 'nit' | 'question' — inline only, else null
  --   event: COMMENT | APPROVE | REQUEST_CHANGES — summary rows only, else null
  CREATE TABLE IF NOT EXISTS findings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id         INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    repo_full_name    TEXT NOT NULL,
    pr_number         INTEGER NOT NULL,
    kind              TEXT NOT NULL,
    severity          TEXT,
    event             TEXT,
    path              TEXT,
    line              INTEGER,
    body              TEXT NOT NULL,
    github_review_id  INTEGER,
    github_comment_id INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Global reviewer skills installed via the dashboard (from skills.sh / GitHub).
  -- One row per skill; opencode auto-discovers enabled ones from the runtime
  -- config dir after reconcileSkills() materialises them (src/skills). The DB is
  -- the source of truth — disk is rebuilt from these rows on boot and on toggle.
  -- Per-repo skills are intentionally NOT here: a repo ships its own under
  -- .claude/skills and opencode picks them up from the worktree for free.
  --   ref:   pinned commit SHA the files were fetched at (reproducibility)
  --   files: JSON [{ path, contentBase64 }] relative to the skill dir (SKILL.md + any bundled files)
  CREATE TABLE IF NOT EXISTS skills (
    name        TEXT PRIMARY KEY,
    source_url  TEXT NOT NULL,
    owner       TEXT NOT NULL,
    repo        TEXT NOT NULL,
    path        TEXT NOT NULL,
    ref         TEXT NOT NULL,
    description TEXT,
    files       TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// ponytail: no migration framework — additive columns via ALTER, ignored once present.
const addColumn = (table: "reviews" | "repos", def: string) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch {
    // column already exists
  }
};
// trigger ∈ {opened, synchronize, reopened, command, retry} — why this review ran.
// Populated at insert in runReviewForPR; null for rows from before the column existed.
// cost/tokens are summed from the opencode session's assistant messages at completion
// (null until the run finishes, or forever for pre-column rows / failures).
// model is the resolved model spec (repo override or default) captured at
// completion, so cost/tokens can be broken down by model. Null for failures,
// aborts, and rows from before the column existed.
// check_run_id is the GitHub check run this review opened, recorded right after
// it's created so the boot orphan reaper can close that exact run instead of
// guessing from the PR's current head. Null for improver runs, for rows that
// died before the check was created, and for pre-column rows.
// patch_id is `git patch-id --stable` over base...head — the identity of the
// diff this review looked at, so a later rebase-only push can recognise it has
// nothing new to review. Written on the SUCCESS path only: a failed, aborted or
// watchdog-killed run must never set a baseline, or a rebase after a failure
// would match it and the diff would sit permanently unreviewed while looking
// clean. Also written on a `skipped` row, so the skip itself is auditable.
// Null for failures, for improver runs, and for pre-column rows.
// attempt is 0 for a first run and 1 for the single automatic retry the runner
// fires after a failure (see src/review/runner.ts) — the retry guard, so a
// failing retry never retries again. Pre-column rows default to 0.
for (const def of [
  "title TEXT",
  "error TEXT",
  "trigger TEXT",
  "cost REAL",
  "tokens INTEGER",
  "model TEXT",
  "check_run_id INTEGER",
  "patch_id TEXT",
  "attempt INTEGER NOT NULL DEFAULT 0",
])
  addColumn("reviews", def);
// repos.enabled is opt-in: a repo the GitHub App can see is auto-inserted
// disabled (repos.upsert forces enabled=0 on first sight), and reviews only run
// once it's enabled in the dashboard. Existing rows keep whatever they were set
// to — ON CONFLICT never touches enabled.
// repos.deny_test_commands is the per-repo override for the deny-test-commands
// toggle: NULL = inherit the global setting, 1 = deny, 0 = explicitly allow.
// Like enabled, repos.upsert never touches it — re-sighting a repo must not
// clobber the override.
for (const def of ["enabled INTEGER NOT NULL DEFAULT 0", "deny_test_commands INTEGER"])
  addColumn("repos", def);

export interface SettingRow {
  key: string;
  value: string;
}

// The full skill row, files blob included — server-only: nothing over the wire
// carries it. SkillMetaRow (shared) is what /api/skills returns.
export interface SkillRow extends SkillMetaRow {
  files: string; // JSON [{ path, contentBase64 }]
}

export interface LatencyRow {
  avg: number | null;
  count: number;
}

// One completed review's duration; percentiles are computed from these in JS.
export interface LatencySampleRow {
  day: string;
  seconds: number;
}

// Dashboard filter params, shared by every stats statement. Null = no filter;
// the guards are baked into the SQL so the statements stay prepared and static.
// A type alias, not an interface: bun:sqlite's binding constraint needs an
// implicit index signature, which interfaces don't have.
export type StatsFilter = {
  $from: number | null;
  // Exclusive upper bound, so an inclusive "to 2026-08-14" is passed as the
  // epoch of 2026-08-15T00:00:00Z — see toEpoch in src/server/api.ts.
  $to: number | null;
  $repo: string | null;
  $model: string | null;
};

export const repos = {
  get: db.prepare<RepoRow, { $full_name: string }>(
    "SELECT * FROM repos WHERE full_name = $full_name",
  ),
  upsert: db.prepare<
    null,
    { $full_name: string; $installation_id: number; $prompt: string | null; $model: string | null }
  >(
    `INSERT INTO repos (full_name, installation_id, prompt, model, enabled)
     VALUES ($full_name, $installation_id, $prompt, $model, 0)
     ON CONFLICT(full_name) DO UPDATE SET
       installation_id = excluded.installation_id`,
  ),
  update: db.prepare<
    null,
    {
      $full_name: string;
      $prompt: string | null;
      $model: string | null;
      $enabled: number;
      $deny_test_commands: number | null;
    }
  >(
    `UPDATE repos SET prompt = $prompt, model = $model, enabled = $enabled,
       deny_test_commands = $deny_test_commands WHERE full_name = $full_name`,
  ),
  remove: db.prepare<null, { $full_name: string }>(
    "DELETE FROM repos WHERE full_name = $full_name",
  ),
  list: db.prepare<RepoRow, []>("SELECT * FROM repos ORDER BY created_at DESC"),
};

export const reviews = {
  insert: db.prepare<
    ReviewRow,
    {
      $repo: string;
      $pr: number;
      $title: string;
      $session: string | null;
      $status: string;
      $trigger: string | null;
      $attempt: number;
    }
  >(
    `INSERT INTO reviews (repo_full_name, pr_number, title, session_id, status, trigger, attempt)
     VALUES ($repo, $pr, $title, $session, $status, $trigger, $attempt)
     RETURNING *`,
  ),
  updateStatus: db.prepare<null, { $status: string; $done: number; $id: number }>(
    `UPDATE reviews SET status = $status,
       completed_at = CASE WHEN $done THEN unixepoch() ELSE completed_at END
     WHERE id = $id`,
  ),
  // Atomic success-path write: status + completed_at + cost + tokens + patch_id
  // in one statement, so a crash mid-completion can't leave a "completed" row
  // with null cost/tokens — nor a baseline patch_id without the success that
  // earns it.
  complete: db.prepare<
    null,
    { $id: number; $cost: number; $tokens: number; $model: string | null; $patch: string | null }
  >(
    `UPDATE reviews SET status = 'completed', completed_at = unixepoch(),
       cost = $cost, tokens = $tokens, model = $model, patch_id = $patch WHERE id = $id`,
  ),
  // A push whose diff is byte-identical to an already-reviewed one. Terminal,
  // and carries the patch_id so the skip is auditable against the row it matched.
  skip: db.prepare<null, { $id: number; $patch: string | null }>(
    `UPDATE reviews SET status = 'skipped', completed_at = unixepoch(), patch_id = $patch
     WHERE id = $id`,
  ),
  fail: db.prepare<null, { $id: number; $error: string }>(
    `UPDATE reviews SET status = 'failed', completed_at = unixepoch(), error = $error
     WHERE id = $id`,
  ),
  setSession: db.prepare<null, { $session: string | null; $id: number }>(
    "UPDATE reviews SET session_id = $session WHERE id = $id",
  ),
  // Recorded as soon as the check run exists, so a crash mid-review leaves the
  // reaper an exact check to close.
  setCheckRun: db.prepare<null, { $check: number | null; $id: number }>(
    "UPDATE reviews SET check_run_id = $check WHERE id = $id",
  ),
  // List view, not an aggregate: `skipped` rows DO appear here, deliberately.
  // The timeline is the history of what happened to a PR, and "we looked and
  // there was nothing new" is part of that history. $status filters to one
  // status on demand, `skipped` included.
  recent: db.prepare<ReviewRow, StatsFilter & { $status: string | null; $limit: number }>(
    `SELECT * FROM reviews
     WHERE ($from IS NULL OR created_at >= $from)
     AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
       AND ($status IS NULL OR status = $status)
     ORDER BY id DESC LIMIT $limit`,
  ),
  byRepo: db.prepare<ReviewRow, { $repo: string; $limit: number }>(
    "SELECT * FROM reviews WHERE repo_full_name = $repo ORDER BY id DESC LIMIT $limit",
  ),
  byRepoPR: db.prepare<ReviewRow, { $repo: string; $pr: number; $limit: number }>(
    "SELECT * FROM reviews WHERE repo_full_name = $repo AND pr_number = $pr ORDER BY id DESC LIMIT $limit",
  ),
  byId: db.prepare<ReviewRow, { $id: number }>("SELECT * FROM reviews WHERE id = $id"),
  // Rows still claiming to be in flight. At boot these are necessarily orphans:
  // the live-review map is in-memory, so nothing can still be running them.
  // `skipped` is terminal and is excluded by this list — a skip must never look
  // in-flight to the boot reaper, which would close a check that's already closed.
  unfinished: db.prepare<ReviewRow, []>(
    "SELECT * FROM reviews WHERE status IN ('pending', 'running') ORDER BY id",
  ),

  // ── Aggregates ──────────────────────────────────────────────────────────
  // `skipped` rows are bookkeeping, not outcomes — every aggregate that counts,
  // sums, averages or groups reviews excludes them explicitly. Explicitly even
  // where a stricter filter already excludes them: an accidental exclusion is a
  // future bug waiting for someone to relax the filter.

  // Excludes skips: COUNT(*) would otherwise inflate the review count for a repo
  // that gets rebased a lot.
  byProject: db.prepare<ProjectStatsRow, StatsFilter>(
    `SELECT repo_full_name,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens,
            AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL
                     THEN completed_at - created_at END) AS avg_duration
     FROM reviews
     WHERE status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     GROUP BY repo_full_name
     ORDER BY cost DESC`,
  ),
  // A skip has no model and no cost, so it must not appear as a model row.
  byModel: db.prepare<ModelStatsRow, StatsFilter>(
    `SELECT model,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens
     FROM reviews
     WHERE model IS NOT NULL AND status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     GROUP BY model
     ORDER BY cost DESC`,
  ),
  // The daily volume/cost trend counts reviews that ran.
  daily: db.prepare<DailyStatsRow, StatsFilter>(
    `SELECT date(created_at, 'unixepoch') AS day,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens
     FROM reviews
     WHERE status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     GROUP BY day
     ORDER BY day`,
  ),
  // The trigger mix answers "what makes fouine run", so a run that didn't happen
  // is not part of it.
  triggers: db.prepare<TriggerStatsRow, StatsFilter>(
    `SELECT COALESCE(trigger, 'unknown') AS trigger, COUNT(*) AS count
     FROM reviews
     WHERE status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     GROUP BY COALESCE(trigger, 'unknown')
     ORDER BY count DESC`,
  ),
  // Distinct models ever used — populates the filter dropdown, so deliberately
  // unfiltered: the list must not shrink when a filter is applied. `skipped`
  // rows carry no model, so they can never contribute one — said explicitly so
  // it stays true if a skip ever starts recording the model it would have used.
  allModels: db.prepare<{ model: string }, []>(
    `SELECT DISTINCT model FROM reviews
     WHERE model IS NOT NULL AND status <> 'skipped'
     ORDER BY model`,
  ),
  // Latency over completed reviews. avg in one pass; p95 needs the ordered
  // offset trick since SQLite has no percentile function. `status = 'completed'`
  // already excludes skips — a skip's near-zero duration would otherwise drag
  // both numbers toward meaningless.
  latencyAgg: db.prepare<LatencyRow, StatsFilter>(
    `SELECT AVG(completed_at - created_at) AS avg,
            COUNT(*) AS count
     FROM reviews
     WHERE status = 'completed' AND completed_at IS NOT NULL
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)`,
  ),
  // The inner subquery must carry the same guards as the outer one, or the
  // offset is computed over a different population than it indexes into.
  latencyP95: db.prepare<{ d: number }, StatsFilter>(
    `SELECT (completed_at - created_at) AS d
     FROM reviews
     WHERE status = 'completed' AND completed_at IS NOT NULL
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     ORDER BY d
     LIMIT 1
     OFFSET (SELECT CAST(0.95 * (COUNT(*) - 1) AS INTEGER)
             FROM reviews
             WHERE status = 'completed' AND completed_at IS NOT NULL
               AND ($from IS NULL OR created_at >= $from)
               AND ($to IS NULL OR created_at < $to)
               AND ($repo IS NULL OR repo_full_name = $repo)
               AND ($model IS NULL OR model = $model))`,
  ),
  // PRs with a completed review since a timestamp — the improver's work list.
  // pr_number > 0 excludes improver runs themselves (stored with pr_number = 0).
  // `status = 'completed'` also excludes skips: a skip must never make the
  // improver think a PR was reviewed in this window — there is no session to learn from.
  // LIMIT keeps one improver session's context bounded on a busy repo; the
  // oldest excess PRs are simply dropped from that pass.
  reviewedPRsSince: db.prepare<{ pr_number: number }, { $repo: string; $since: number }>(
    `SELECT pr_number, MAX(created_at) AS last
     FROM reviews
     WHERE repo_full_name = $repo AND status = 'completed'
       AND pr_number > 0 AND created_at > $since
     GROUP BY pr_number
     ORDER BY last DESC
     LIMIT 20`,
  ),
  // The most expensive reviews. A skip costs nothing, but exclude it explicitly
  // rather than leaning on `cost IS NOT NULL` staying that way.
  topCost: db.prepare<TopCostRow, StatsFilter>(
    `SELECT id, repo_full_name, pr_number, cost, tokens, model
     FROM reviews
     WHERE cost IS NOT NULL AND status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     ORDER BY cost DESC
     LIMIT 5`,
  ),
  // Outcomes per day. Only four statuses are ever written — pending, running,
  // completed, failed — and there is no separate aborted/killed: a user stop
  // and a watchdog kill both go through reviews.fail, so they land in `failed`
  // with an error message. pending/running are counted apart because they have
  // no outcome yet; folding them into either column would be a lie, and
  // dropping them would make this panel's bars disagree with the cost trend
  // directly above it. `skipped` is a fifth status now, and it is not an outcome:
  // it matches none of the three FILTERs, so leaving it in would not move any bar
  // — it would only conjure all-zero day rows on days when nothing but rebases
  // happened. Excluded explicitly, and the moment anyone adds a bare COUNT(*)
  // here for a total, the guard is already in place.
  reliabilityDaily: db.prepare<ReliabilityRow, StatsFilter>(
    `SELECT date(created_at, 'unixepoch') AS day,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status IN ('pending', 'running')) AS in_flight
     FROM reviews
     WHERE status <> 'skipped'
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     GROUP BY day
     ORDER BY day`,
  ),
  // One row per completed review, for percentiles computed in JS. SQLite has no
  // percentile function and the per-group OFFSET trick would need one correlated
  // subquery per day, so the rows come out raw instead.
  // ponytail: LIMIT 5000 is the ceiling — a window with more completed reviews
  // than that silently trends on the oldest 5000. Push the percentile into SQL
  // (window functions) if that limit is ever reached in anger.
  latencySamples: db.prepare<LatencySampleRow, StatsFilter>(
    `SELECT date(created_at, 'unixepoch') AS day,
            (completed_at - created_at) AS seconds
     FROM reviews
     WHERE status = 'completed' AND completed_at IS NOT NULL
       AND ($from IS NULL OR created_at >= $from)
       AND ($to IS NULL OR created_at < $to)
       AND ($repo IS NULL OR repo_full_name = $repo)
       AND ($model IS NULL OR model = $model)
     ORDER BY created_at
     LIMIT 5000`,
  ),

  // The baseline for the skip decision: the newest review that actually
  // succeeded on this PR and recorded a diff identity. Only 'completed' rows
  // qualify — a failed or killed run must never let a later push skip.
  // pr_number > 0 excludes improver runs (stored with pr_number = 0), which
  // would otherwise shadow a real PR's baseline.
  lastReviewedPatch: db.prepare<
    { id: number; patch_id: string },
    { $repo: string; $pr: number }
  >(
    `SELECT id, patch_id FROM reviews
     WHERE repo_full_name = $repo AND pr_number = $pr AND pr_number > 0
       AND status = 'completed' AND patch_id IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
  ),
};

export const findings = {
  insert: db.prepare<
    null,
    {
      $review: number;
      $repo: string;
      $pr: number;
      $kind: string;
      $severity: string | null;
      $event: string | null;
      $path: string | null;
      $line: number | null;
      $body: string;
      $github_review_id: number | null;
      $github_comment_id: number | null;
    }
  >(
    `INSERT INTO findings
       (review_id, repo_full_name, pr_number, kind, severity, event, path, line, body,
        github_review_id, github_comment_id)
     VALUES ($review, $repo, $pr, $kind, $severity, $event, $path, $line, $body,
        $github_review_id, $github_comment_id)`,
  ),
  byReview: db.prepare<FindingRow, { $review: number }>(
    "SELECT * FROM findings WHERE review_id = $review ORDER BY id",
  ),
  // Severity mix across all inline findings, for the dashboard.
  // All three guards read from the joined review, not from the finding's own
  // row: findings are written after the review runs, so a finding recorded just
  // past a range boundary would drop out of this panel while its review still
  // counts in every other one. Filtering the review population keeps the
  // severity mix describing the same reviews the rest of the page describes.
  bySeverity: db.prepare<SeverityStatsRow, StatsFilter>(
    `SELECT findings.severity AS severity, COUNT(*) AS count
     FROM findings
     JOIN reviews ON findings.review_id = reviews.id
     WHERE findings.kind = 'inline' AND findings.severity IS NOT NULL
       AND ($from IS NULL OR reviews.created_at >= $from)
       AND ($to IS NULL OR reviews.created_at < $to)
       AND ($repo IS NULL OR reviews.repo_full_name = $repo)
       AND ($model IS NULL OR reviews.model = $model)
     GROUP BY findings.severity
     ORDER BY count DESC`,
  ),
  // Findings per day by severity. Bucketed and scoped by the REVIEW's date and
  // repo, not the finding's own — same rule as bySeverity above: findings are
  // written after the review runs, so scoping by findings.created_at would drop
  // findings whose review is inside the window.
  dailyBySeverity: db.prepare<FindingsDailyRow, StatsFilter>(
    `SELECT date(reviews.created_at, 'unixepoch') AS day,
            findings.severity AS severity,
            COUNT(*) AS count
     FROM findings
     JOIN reviews ON findings.review_id = reviews.id
     WHERE findings.kind = 'inline' AND findings.severity IS NOT NULL
       AND ($from IS NULL OR reviews.created_at >= $from)
       AND ($to IS NULL OR reviews.created_at < $to)
       AND ($repo IS NULL OR reviews.repo_full_name = $repo)
       AND ($model IS NULL OR reviews.model = $model)
     GROUP BY day, findings.severity
     ORDER BY day`,
  ),
  // Files that attract the most review comments. path is null on summary and
  // comment rows, which is what excludes them. Scoped by the review, as above.
  topFiles: db.prepare<TopFileRow, StatsFilter>(
    `SELECT findings.path AS path, COUNT(*) AS count
     FROM findings
     JOIN reviews ON findings.review_id = reviews.id
     WHERE findings.path IS NOT NULL
       AND ($from IS NULL OR reviews.created_at >= $from)
       AND ($to IS NULL OR reviews.created_at < $to)
       AND ($repo IS NULL OR reviews.repo_full_name = $repo)
       AND ($model IS NULL OR reviews.model = $model)
     GROUP BY findings.path
     ORDER BY count DESC, findings.path
     LIMIT 10`,
  ),
};

export const settings = {
  get: db.prepare<SettingRow, { $key: string }>("SELECT * FROM settings WHERE key = $key"),
  set: db.prepare<null, { $key: string; $value: string }>(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ),
  del: db.prepare<null, { $key: string }>("DELETE FROM settings WHERE key = $key"),
  all: db.prepare<SettingRow, []>("SELECT * FROM settings ORDER BY key"),
};

export function settingValue(key: string): string | undefined {
  return settings.get.get({ $key: key })?.value;
}

const SKILL_META_COLS =
  "name, source_url, owner, repo, path, ref, description, enabled, created_at";

export const skills = {
  // Install/replace by name — installs enabled (live on the next review);
  // re-installing the same skill updates it in place and keeps it enabled.
  upsert: db.prepare<
    null,
    {
      $name: string;
      $source_url: string;
      $owner: string;
      $repo: string;
      $path: string;
      $ref: string;
      $description: string | null;
      $files: string;
    }
  >(
    `INSERT INTO skills (name, source_url, owner, repo, path, ref, description, files, enabled)
     VALUES ($name, $source_url, $owner, $repo, $path, $ref, $description, $files, 1)
     ON CONFLICT(name) DO UPDATE SET
       source_url = excluded.source_url,
       owner = excluded.owner,
       repo = excluded.repo,
       path = excluded.path,
       ref = excluded.ref,
       description = excluded.description,
       files = excluded.files,
       enabled = 1`,
  ),
  setEnabled: db.prepare<null, { $name: string; $enabled: number }>(
    "UPDATE skills SET enabled = $enabled WHERE name = $name",
  ),
  remove: db.prepare<null, { $name: string }>("DELETE FROM skills WHERE name = $name"),
  getMeta: db.prepare<SkillMetaRow, { $name: string }>(
    `SELECT ${SKILL_META_COLS} FROM skills WHERE name = $name`,
  ),
  list: db.prepare<SkillMetaRow, []>(
    `SELECT ${SKILL_META_COLS} FROM skills ORDER BY created_at DESC`,
  ),
  // Full rows (with files) for the ones we materialise to disk.
  enabled: db.prepare<SkillRow, []>("SELECT * FROM skills WHERE enabled = 1 ORDER BY name"),
};

export type { Database };
