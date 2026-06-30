import { Database } from "bun:sqlite";
import { config } from "~/config";

const db = new Database(config.dbPath, { create: true });
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

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
for (const def of ["title TEXT", "error TEXT"]) addColumn("reviews", def);
// repos.enabled default 1 preserves the old "review every installed repo" behaviour;
// the dashboard can flip it off.
for (const def of ["enabled INTEGER NOT NULL DEFAULT 1"]) addColumn("repos", def);

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
  created_at: number;
  completed_at: number | null;
}

export interface SettingRow {
  key: string;
  value: string;
}

export const repos = {
  get: db.prepare<RepoRow, { $full_name: string }>(
    "SELECT * FROM repos WHERE full_name = $full_name",
  ),
  upsert: db.prepare<
    null,
    { $full_name: string; $installation_id: number; $prompt: string | null; $model: string | null }
  >(
    `INSERT INTO repos (full_name, installation_id, prompt, model)
     VALUES ($full_name, $installation_id, $prompt, $model)
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
    { $repo: string; $pr: number; $title: string; $session: string | null; $status: string }
  >(
    `INSERT INTO reviews (repo_full_name, pr_number, title, session_id, status)
     VALUES ($repo, $pr, $title, $session, $status)
     RETURNING *`,
  ),
  updateStatus: db.prepare<null, { $status: string; $done: number; $id: number }>(
    `UPDATE reviews SET status = $status,
       completed_at = CASE WHEN $done THEN unixepoch() ELSE completed_at END
     WHERE id = $id`,
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
  byId: db.prepare<ReviewRow, { $id: number }>("SELECT * FROM reviews WHERE id = $id"),
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

export type { Database };
