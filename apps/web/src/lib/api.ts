import { treaty } from "@elysiajs/eden";
import type { App } from "~/server/api";
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
// so components keep importing them from "@/lib/api". They aren't hand
// duplicates: the server's prepared statements are typed with these same
// interfaces, so Eden already infers them structurally — re-exporting is
// just a convenience import path for components.
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

// Same origin, relative — matches the previous `fetch("/api/...")` wrapper.
// Cookies ride along automatically for a same-origin request, same as before.
const client = treaty<App>(window.location.origin);
const c = client.api;

// Server errors are `{ error }` (sometimes `{ message }`) JSON, or a plain
// text body (e.g. the 404 routes' `new Response("Not found", ...)`). Preserve
// the exact message shape the old wrapper produced: toasts show `e.message`.
function toError(error: { status: number; value: unknown }): Error {
  const v = error.value;
  if (v && typeof v === "object") {
    const m = (v as Record<string, unknown>).error ?? (v as Record<string, unknown>).message;
    if (typeof m === "string" && m) return new Error(m);
  }
  if (typeof v === "string" && v) return new Error(v);
  return new Error(`HTTP ${error.status}`);
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw toError(error as { status: number; value: unknown });
  return data as T;
}

// A handful of routes 404 via a raw `new Response(...)` (or return a `{error}`
// object on a non-200 status) instead of a declared error status — no
// `response` schema on those handlers — so Eden folds that branch into the
// success type instead of `error`. Runtime behavior is still correct (Eden
// keys off the real status code), so this is a deliberate cast at the
// boundary for exactly those routes, same as the old wrapper's `res.json()`
// cast, rather than a route-file schema change (out of scope for this pass —
// see the schema-less-route count in the report).
function unwrapLoose<T>({ data, error }: { data: unknown; error: unknown }): T {
  if (error) throw toError(error as { status: number; value: unknown });
  return data as T;
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

// Route query objects go straight to Eden — it drops null/undefined keys
// itself, same "no filter" behavior the old hand-rolled qs() gave us.
function statsQuery(q: StatsQuery) {
  return { range: q.range, from: q.from, to: q.to, repo: q.repo, model: q.model };
}

export const api = {
  repos: {
    list: async () => unwrap<RepoRow[]>(await c.repos.get()),
    get: async (owner: string, name: string) =>
      unwrapLoose<RepoRow>(await c.repos({ owner })({ name }).get()),
    create: async (data: { full_name: string; installation_id: number }) =>
      unwrap<RepoRow>(await c.repos.post(data)),
    update: async (
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
    ) => unwrapLoose<RepoRow>(await c.repos({ owner })({ name }).put(data)),
    delete: async (owner: string, name: string) =>
      unwrapLoose<void>(await c.repos({ owner })({ name }).delete()),
    reviews: async (owner: string, name: string) =>
      unwrap<ReviewRow[]>(await c.repos({ owner })({ name }).reviews.get()),
    prReviews: async (owner: string, name: string, number: number) =>
      unwrap<ReviewRow[]>(await c.repos({ owner })({ name }).pr({ number }).get()),
    improve: async (owner: string, name: string) =>
      unwrap<{ ok: boolean }>(await c.repos({ owner })({ name }).improve.post()),
  },
  reviews: {
    list: async () => unwrap<ReviewRow[]>(await c.reviews.get()),
    // Kept separate from `list` so the zero-arg version stays usable as a bare
    // react-query queryFn (which would otherwise pass its context as filters).
    query: async (q: ReviewsQuery) =>
      unwrap<ReviewRow[]>(
        await c.reviews.get({ query: { ...statsQuery(q), status: q.status, limit: q.limit } }),
      ),
    get: async (id: number) => unwrapLoose<ReviewRow>(await c.reviews({ id }).get()),
    findings: async (id: number) =>
      unwrap<FindingRow[]>(await c.reviews({ id }).findings.get()),
    session: async (id: number) => unwrap<unknown>(await c.reviews({ id }).session.get()),
    retry: async (id: number) => unwrap<{ ok: boolean }>(await c.reviews({ id }).retry.post()),
    stop: async (id: number) =>
      unwrap<{ ok: boolean; live?: boolean; reason?: string }>(
        await c.reviews({ id }).stop.post(),
      ),
  },
  stats: {
    get: async () => unwrap<Stats>(await c.stats.get()),
    query: async (q: StatsQuery) => unwrap<Stats>(await c.stats.get({ query: statsQuery(q) })),
    // Separate route so the dashboard's /stats payload doesn't carry the
    // latency samples these panels need and it never renders.
    charts: async (q: StatsQuery) =>
      unwrap<StatsCharts>(await c.stats.charts.get({ query: statsQuery(q) })),
  },
  models: {
    // Server-side filtered and capped — the full models.dev catalog is ~1MB.
    search: async (q: string, all = false) =>
      unwrap<{ models: ModelOption[]; total: number; providers: string[]; error?: string }>(
        await c.models.get({ query: { q, all: all ? "1" : undefined } }),
      ),
  },
  settings: {
    get: async () => unwrap<Settings>(await c.settings.get()),
    update: async (data: Settings) => unwrap<Settings>(await c.settings.put(data)),
    test: async () =>
      unwrap<{ ok: boolean; text?: string; error?: string }>(await c.settings.test.get()),
  },
  skills: {
    list: async () => unwrap<SkillMetaRow[]>(await c.skills.get()),
    install: async (url: string) => unwrapLoose<SkillMetaRow>(await c.skills.post({ url })),
    setEnabled: async (name: string, enabled: boolean) =>
      unwrapLoose<SkillMetaRow>(await c.skills({ name }).put({ enabled })),
    remove: async (name: string) => unwrapLoose<void>(await c.skills({ name }).delete()),
  },
};
