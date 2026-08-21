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

// The API row shapes are declared once in @fouine/shared and re-exported here,
// so components keep importing them from "@/lib/api".
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
  TopCostRow,
  TopFileRow,
  TriggerStatsRow,
  // What /api/skills returns: the skill row minus the files blob.
  SkillMetaRow as SkillRow,
} from "@fouine/shared";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export interface Stats {
  projects: ProjectStatsRow[];
  models: ModelStatsRow[];
  daily: DailyStatsRow[];
  triggers: TriggerStatsRow[];
  latency: { avg: number | null; count: number; p95: number | null };
  topCost: TopCostRow[];
  severity: SeverityStatsRow[];
  // Every model ever seen, unfiltered and alphabetical — it populates the
  // model dropdown, so it must not shrink when a filter is applied.
  allModels: string[];
}

export type StatsRange = "24h" | "7d" | "30d" | "90d" | "all";

export interface StatsQuery {
  range?: StatsRange;
  // YYYY-MM-DD custom window. When either is set the server ignores `range`.
  from?: string;
  to?: string;
  repo?: string;
  model?: string;
}

export interface ReviewsQuery extends StatsQuery {
  status?: string;
  limit?: number;
}

// Only known keys land in the URL — the filter objects come straight from
// router search params.
function qs(q: ReviewsQuery): string {
  const p = new URLSearchParams();
  for (const k of ["range", "from", "to", "repo", "model", "status", "limit"] as const) {
    const v = q[k];
    if (v) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// p50/p95 are null for a day with no completed reviews — render a dash, not a 0.
export interface LatencyDayRow {
  day: string;
  count: number;
  p50: number | null;
  p95: number | null;
}

export interface StatsCharts {
  reliability: ReliabilityRow[];
  latency: LatencyDayRow[];
  latencyTruncated: boolean;
  findingsDaily: FindingsDailyRow[];
  topFiles: TopFileRow[];
}

export interface ModelOption {
  id: string;
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  configured: boolean;
}

export interface Settings {
  opencode_api_key?: string;
  zai_api_key?: string;
  opencode_model?: string;
  default_prompt?: string;
  improver_model?: string;
  // "1" = on, "" = delete the row (off). See SETTINGS.DENY_TEST_COMMANDS.
  deny_test_commands?: string;
}

export const api = {
  repos: {
    list: () => request<RepoRow[]>("/repos"),
    get: (owner: string, name: string) => request<RepoRow>(`/repos/${owner}/${name}`),
    create: (data: { full_name: string; installation_id: number }) =>
      request<RepoRow>("/repos", { method: "POST", body: JSON.stringify(data) }),
    update: (
      owner: string,
      name: string,
      // deny_test_commands: 1 = deny, 0 = allow, null = inherit the global
      // default. Absent leaves the stored value alone, so clearing an override
      // means sending an explicit null.
      data: {
        prompt?: string;
        model?: string;
        enabled?: number;
        deny_test_commands?: number | null;
      },
    ) =>
      request<RepoRow>(`/repos/${owner}/${name}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (owner: string, name: string) =>
      request<void>(`/repos/${owner}/${name}`, { method: "DELETE" }),
    reviews: (owner: string, name: string) =>
      request<ReviewRow[]>(`/repos/${owner}/${name}/reviews`),
    prReviews: (owner: string, name: string, number: number) =>
      request<ReviewRow[]>(`/repos/${owner}/${name}/pr/${number}`),
    improve: (owner: string, name: string) =>
      request<{ ok: boolean }>(`/repos/${owner}/${name}/improve`, { method: "POST" }),
  },
  reviews: {
    list: () => request<ReviewRow[]>("/reviews"),
    // Kept separate from `list` so the zero-arg version stays usable as a bare
    // react-query queryFn (which would otherwise pass its context as filters).
    query: (q: ReviewsQuery) => request<ReviewRow[]>(`/reviews${qs(q)}`),
    get: (id: number) => request<ReviewRow>(`/reviews/${id}`),
    findings: (id: number) => request<FindingRow[]>(`/reviews/${id}/findings`),
    session: (id: number) => request<unknown>(`/reviews/${id}/session`),
    retry: (id: number) => request<{ ok: boolean }>(`/reviews/${id}/retry`, { method: "POST" }),
    stop: (id: number) =>
      request<{ ok: boolean; live?: boolean; reason?: string }>(`/reviews/${id}/stop`, {
        method: "POST",
      }),
  },
  stats: {
    get: () => request<Stats>("/stats"),
    query: (q: StatsQuery) => request<Stats>(`/stats${qs(q)}`),
    // Separate route so the dashboard's /stats payload doesn't carry the
    // latency samples these panels need and it never renders.
    charts: (q: StatsQuery) => request<StatsCharts>(`/stats/charts${qs(q)}`),
  },
  models: {
    // Server-side filtered and capped — the full models.dev catalog is ~1MB.
    search: (q: string, all = false) =>
      request<{ models: ModelOption[]; total: number; providers: string[]; error?: string }>(
        `/models?q=${encodeURIComponent(q)}${all ? "&all=1" : ""}`,
      ),
  },
  settings: {
    get: () => request<Settings>("/settings"),
    update: (data: Settings) =>
      request<Settings>("/settings", { method: "PUT", body: JSON.stringify(data) }),
    test: () => request<{ ok: boolean; text?: string; error?: string }>("/settings/test"),
  },
  skills: {
    list: () => request<SkillMetaRow[]>("/skills"),
    install: (url: string) =>
      request<SkillMetaRow>("/skills", { method: "POST", body: JSON.stringify({ url }) }),
    setEnabled: (name: string, enabled: boolean) =>
      request<SkillMetaRow>(`/skills/${name}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    remove: (name: string) => request<void>(`/skills/${name}`, { method: "DELETE" }),
  },
};
