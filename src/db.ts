import { Database } from "bun:sqlite";
import { config } from "~/config";

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
for (const def of ["title TEXT", "error TEXT", "trigger TEXT", "cost REAL", "tokens INTEGER", "model TEXT"])
  addColumn("reviews", def);
// repos.enabled is opt-in: a repo the GitHub App can see is auto-inserted
// disabled (repos.upsert forces enabled=0 on first sight), and reviews only run
// once it's enabled in the dashboard. Existing rows keep whatever they were set
// to — ON CONFLICT never touches enabled.
for (const def of ["enabled INTEGER NOT NULL DEFAULT 0"]) addColumn("repos", def);

export interface RepoRow {
  full_name: string;
  installation_id: number;
  prompt: string | null;
  model: string | null;
  enabled: number;
  created_at: number;
}

export interface ReviewRow {
  id: number;
  repo_full_name: string;
  pr_number: number;
  title: string | null;
  session_id: string | null;
  status: string;
  error: string | null;
  trigger: string | null;
  cost: number | null;
  tokens: number | null;
  model: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface FindingRow {
  id: number;
  review_id: number;
  repo_full_name: string;
  pr_number: number;
  kind: string; // 'inline' | 'summary' | 'comment'
  severity: string | null; // 'blocking' | 'nit' | 'question' (inline only)
  event: string | null; // COMMENT | APPROVE | REQUEST_CHANGES (summary only)
  path: string | null;
  line: number | null;
  body: string;
  github_review_id: number | null;
  github_comment_id: number | null;
  created_at: number;
}

// Findings grouped by severity for the dashboard. Only inline findings carry a
// severity, so summary/comment rows are excluded by the WHERE clause.
export interface SeverityStatsRow {
  severity: string;
  count: number;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface SkillRow {
  name: string;
  source_url: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  description: string | null;
  files: string; // JSON [{ path, contentBase64 }]
  enabled: number;
  created_at: number;
}

// Skill row without the (potentially large) files blob — for list/detail views
// that only need metadata. Kept in sync with SkillRow's non-files columns.
export type SkillMetaRow = Omit<SkillRow, "files">;

// Aggregate rows for the dashboard stats. SUM ignores null cost/tokens
// (failures, pre-column rows); COALESCE keeps them 0 not null. avg_duration is
// null for a project with no completed reviews yet.
export interface ProjectStatsRow {
  repo_full_name: string;
  reviews: number;
  cost: number;
  tokens: number;
  avg_duration: number | null;
}

export interface ModelStatsRow {
  model: string;
  reviews: number;
  cost: number;
  tokens: number;
}

export interface DailyStatsRow {
  day: string; // "YYYY-MM-DD" (UTC)
  reviews: number;
  cost: number;
  tokens: number;
}

export interface TriggerStatsRow {
  trigger: string;
  count: number;
}

export interface LatencyRow {
  avg: number | null;
  count: number;
}

export interface TopCostRow {
  id: number;
  repo_full_name: string;
  pr_number: number;
  cost: number;
  tokens: number | null;
  model: string | null;
}

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
    { $full_name: string; $prompt: string | null; $model: string | null; $enabled: number }
  >(
    `UPDATE repos SET prompt = $prompt, model = $model, enabled = $enabled WHERE full_name = $full_name`,
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
    }
  >(
    `INSERT INTO reviews (repo_full_name, pr_number, title, session_id, status, trigger)
     VALUES ($repo, $pr, $title, $session, $status, $trigger)
     RETURNING *`,
  ),
  updateStatus: db.prepare<null, { $status: string; $done: number; $id: number }>(
    `UPDATE reviews SET status = $status,
       completed_at = CASE WHEN $done THEN unixepoch() ELSE completed_at END
     WHERE id = $id`,
  ),
  // Atomic success-path write: status + completed_at + cost + tokens in one
  // statement, so a crash mid-completion can't leave a "completed" row with
  // null cost/tokens.
  complete: db.prepare<
    null,
    { $id: number; $cost: number; $tokens: number; $model: string | null }
  >(
    `UPDATE reviews SET status = 'completed', completed_at = unixepoch(),
       cost = $cost, tokens = $tokens, model = $model WHERE id = $id`,
  ),
  fail: db.prepare<null, { $id: number; $error: string }>(
    `UPDATE reviews SET status = 'failed', completed_at = unixepoch(), error = $error
     WHERE id = $id`,
  ),
  setSession: db.prepare<null, { $session: string | null; $id: number }>(
    "UPDATE reviews SET session_id = $session WHERE id = $id",
  ),
  recent: db.prepare<ReviewRow, { $limit: number }>(
    "SELECT * FROM reviews ORDER BY id DESC LIMIT $limit",
  ),
  byRepo: db.prepare<ReviewRow, { $repo: string; $limit: number }>(
    "SELECT * FROM reviews WHERE repo_full_name = $repo ORDER BY id DESC LIMIT $limit",
  ),
  byRepoPR: db.prepare<ReviewRow, { $repo: string; $pr: number; $limit: number }>(
    "SELECT * FROM reviews WHERE repo_full_name = $repo AND pr_number = $pr ORDER BY id DESC LIMIT $limit",
  ),
  byId: db.prepare<ReviewRow, { $id: number }>("SELECT * FROM reviews WHERE id = $id"),
  byProject: db.prepare<ProjectStatsRow, []>(
    `SELECT repo_full_name,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens,
            AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL
                     THEN completed_at - created_at END) AS avg_duration
     FROM reviews
     GROUP BY repo_full_name
     ORDER BY cost DESC`,
  ),
  byModel: db.prepare<ModelStatsRow, []>(
    `SELECT model,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens
     FROM reviews
     WHERE model IS NOT NULL
     GROUP BY model
     ORDER BY cost DESC`,
  ),
  daily: db.prepare<DailyStatsRow, []>(
    `SELECT date(created_at, 'unixepoch') AS day,
            COUNT(*) AS reviews,
            COALESCE(SUM(cost), 0) AS cost,
            COALESCE(SUM(tokens), 0) AS tokens
     FROM reviews
     WHERE created_at >= unixepoch() - 30 * 86400
     GROUP BY day
     ORDER BY day`,
  ),
  triggers: db.prepare<TriggerStatsRow, []>(
    `SELECT COALESCE(trigger, 'unknown') AS trigger, COUNT(*) AS count
     FROM reviews
     GROUP BY COALESCE(trigger, 'unknown')
     ORDER BY count DESC`,
  ),
  // Latency over completed reviews. avg in one pass; p95 needs the ordered
  // offset trick since SQLite has no percentile function.
  latencyAgg: db.prepare<LatencyRow, []>(
    `SELECT AVG(completed_at - created_at) AS avg,
            COUNT(*) AS count
     FROM reviews
     WHERE status = 'completed' AND completed_at IS NOT NULL`,
  ),
  latencyP95: db.prepare<{ d: number }, []>(
    `SELECT (completed_at - created_at) AS d
     FROM reviews
     WHERE status = 'completed' AND completed_at IS NOT NULL
     ORDER BY d
     LIMIT 1
     OFFSET (SELECT CAST(0.95 * (COUNT(*) - 1) AS INTEGER)
             FROM reviews WHERE status = 'completed' AND completed_at IS NOT NULL)`,
  ),
  // PRs with a completed review since a timestamp — the improver's work list.
  // pr_number > 0 excludes improver runs themselves (stored with pr_number = 0).
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
  topCost: db.prepare<TopCostRow, []>(
    `SELECT id, repo_full_name, pr_number, cost, tokens, model
     FROM reviews
     WHERE cost IS NOT NULL
     ORDER BY cost DESC
     LIMIT 5`,
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
  bySeverity: db.prepare<SeverityStatsRow, []>(
    `SELECT severity, COUNT(*) AS count
     FROM findings
     WHERE kind = 'inline' AND severity IS NOT NULL
     GROUP BY severity
     ORDER BY count DESC`,
  ),
};

export const settings = {
  get: db.prepare<SettingRow, { $key: string }>("SELECT * FROM settings WHERE key = $key"),
  set: db.prepare<null, { $key: string; $value: string }>(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ),
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
