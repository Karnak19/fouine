// The REST contract between the server and the dashboard: the row shapes the
// API actually hands back. Both sides import these instead of keeping two
// hand-written copies in sync.
// ponytail: plain interfaces, no zod, no codegen — the SQL is the validator and
// these describe what it returns. Add runtime validation only if a third party
// ever posts these shapes.

export interface RepoRow {
  full_name: string;
  installation_id: number;
  prompt: string | null;
  model: string | null;
  // SQLite boolean: 0 | 1, not a JS boolean.
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
  check_run_id: number | null;
  patch_id: string | null;
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

// Findings grouped by severity for the dashboard. Only inline findings carry a
// severity, so summary/comment rows are excluded by the WHERE clause.
export interface SeverityStatsRow {
  severity: string;
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

// Daily outcome mix. in_flight = pending + running, which have no outcome yet
// and are therefore excluded from the success rate's denominator.
export interface ReliabilityRow {
  day: string;
  completed: number;
  failed: number;
  in_flight: number;
}

export interface FindingsDailyRow {
  day: string;
  severity: string;
  count: number;
}

export interface TopFileRow {
  path: string;
  count: number;
}

// Skill row without the (potentially large) files blob — what /api/skills
// returns. The server's full SkillRow adds `files` on top of this.
export interface SkillMetaRow {
  name: string;
  source_url: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  description: string | null;
  enabled: number;
  created_at: number;
}
