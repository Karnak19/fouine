import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  api,
  type DailyStatsRow,
  type ModelStatsRow,
  type ProjectStatsRow,
  type ReviewRow,
  type SeverityStatsRow,
  type Stats,
  type StatsRange,
  type TriggerStatsRow,
} from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatSeconds, formatTokens, timeAgo, triggerLabel } from "@/lib/format";
import { Inbox, ListFilter, SlidersHorizontal, X } from "lucide-react";

const RANGES = ["24h", "7d", "30d", "90d", "all"] as const;
const DEFAULT_RANGE: StatsRange = "30d";
const STATUSES = ["pending", "running", "completed", "failed"] as const;
type Status = (typeof STATUSES)[number];

export interface StatsSearch {
  // `range` is absent from the URL when it's the default — a clean link for the
  // default view. Everything reads it through `search.range ?? DEFAULT_RANGE`.
  range?: StatsRange;
  repo?: string;
  model?: string;
  status?: Status;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export function validateStatsSearch(raw: Record<string, unknown>): StatsSearch {
  const range = RANGES.find((r) => r === raw.range && r !== DEFAULT_RANGE);
  const status = STATUSES.find((s) => s === raw.status);
  return { range, repo: str(raw.repo), model: str(raw.model), status };
}

export default function StatsPage() {
  const search = useSearch({ strict: false }) as StatsSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const range = search.range ?? DEFAULT_RANGE;
  const filters = { range, repo: search.repo, model: search.model };
  const reviewFilters = { ...filters, status: search.status };

  const setFilters = (patch: StatsSearch) =>
    navigate({
      to: "/stats",
      search: (prev: Record<string, unknown>) => validateStatsSearch({ ...prev, ...patch }),
    });

  const { status: liveStatus, resync } = useLiveEvents(null, (e) => {
    if (e.type.startsWith("review:")) {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  }, [resync, queryClient]);

  const { data: stats } = useQuery({
    queryKey: ["stats", filters],
    queryFn: () => api.stats.query(filters),
  });
  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: api.repos.list });
  const { data: reviews, isPending: reviewsPending } = useQuery({
    queryKey: ["reviews", reviewFilters],
    queryFn: () => api.reviews.query(reviewFilters),
  });

  const totals = stats?.projects.reduce(
    (acc, p) => {
      acc.reviews += p.reviews;
      acc.cost += p.cost;
      acc.tokens += p.tokens;
      return acc;
    },
    { reviews: 0, cost: 0, tokens: 0 },
  );
  const avgCost = totals && stats?.latency.count ? totals.cost / stats.latency.count : null;
  const filtered = Boolean(search.repo || search.model || search.status || search.range);

  return (
    <div className="space-y-7 min-w-0">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stats</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Slice fouine's activity by time, repository and model.
          </p>
        </div>
        <LiveBadge status={liveStatus} />
      </div>

      {/* One compact filter bar; every control writes to the URL. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <SlidersHorizontal size={14} className="text-zinc-500 shrink-0" />
        <div
          role="group"
          aria-label="Time range"
          className="flex overflow-hidden rounded-md border border-zinc-800"
        >
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setFilters({ range: r === DEFAULT_RANGE ? undefined : r })}
              className={`px-2.5 py-1 text-xs font-medium tabular-nums transition-colors cursor-pointer ${
                r === range
                  ? "bg-ember-950/60 text-ember-300"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <Select
          label="Repository"
          value={search.repo ?? ""}
          onChange={(v) => setFilters({ repo: v || undefined })}
          options={(repos ?? []).map((r) => r.full_name)}
          placeholder="All repositories"
        />
        <Select
          label="Model"
          value={search.model ?? ""}
          onChange={(v) => setFilters({ model: v || undefined })}
          options={stats?.allModels ?? []}
          placeholder="All models"
        />
        <Select
          label="Review status (table only)"
          value={search.status ?? ""}
          onChange={(v) => setFilters({ status: (v || undefined) as Status | undefined })}
          options={[...STATUSES]}
          placeholder="Any status"
        />
        {filtered && (
          <button
            type="button"
            onClick={() => navigate({ to: "/stats", search: {} })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 cursor-pointer"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-lg border border-zinc-800 divide-x divide-y lg:divide-y-0 divide-zinc-800 overflow-hidden bg-zinc-900/40">
        <Stat label="Reviews" value={totals ? String(totals.reviews) : null} />
        <Stat
          label="Avg review"
          value={stats ? (formatSeconds(stats.latency.avg) ?? "—") : null}
          sub={stats?.latency.count ? `${stats.latency.count} done` : undefined}
        />
        <Stat label="p95 review" value={stats ? (formatSeconds(stats.latency.p95) ?? "—") : null} />
        <Stat label="Cost" value={totals ? (formatCost(totals.cost) ?? "—") : null} />
        <Stat label="Avg cost / review" value={stats ? (formatCost(avgCost) ?? "—") : null} />
        <Stat label="Tokens" value={totals ? (formatTokens(totals.tokens) ?? "—") : null} />
      </div>

      {/* Desktop: the trend gets two thirds of the width, the two mix bars stack
          beside it. Everything collapses to one column below `lg`. */}
      <div className="grid gap-7 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 min-w-0">
          <CostTrend daily={stats?.daily} range={range} />
        </div>
        <div className="space-y-7 min-w-0">
          <SeverityMix severity={stats?.severity} />
          <TriggerMix triggers={stats?.triggers} />
        </div>
      </div>

      {/* Two wide tables with long identifiers in the first column. 3/5 + 2/5
          rather than 2/3 + 1/3, which clipped the model table's cost column, or
          a straight half each, which then clipped the wider project table. */}
      <div className="grid gap-7 lg:grid-cols-5 items-start">
        <div className="lg:col-span-3 min-w-0">
          <ProjectStats
            projects={stats?.projects}
            active={search.repo}
            onFilter={(repo) => setFilters({ repo })}
          />
        </div>
        <div className="lg:col-span-2 min-w-0">
          <ModelStats
            models={stats?.models}
            active={search.model}
            onFilter={(model) => setFilters({ model })}
          />
        </div>
      </div>

      <div className="grid gap-7 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 min-w-0">
          <Reviews rows={reviews} pending={reviewsPending} />
        </div>
        <TopCost rows={stats?.topCost} />
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-52 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-ember-500 cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  // min-w-0: grid/flex children default to min-width:auto, which makes a panel
  // expand to its widest table instead of letting that table scroll inside its
  // own overflow-x box — which on a phone pushes the whole page sideways. Every
  // grid wrapper in this file carries min-w-0 for the same reason.
  return (
    <section className={`flex min-w-0 flex-col space-y-2.5 ${className ?? ""}`}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      {/* Deliberately a block, not a flex column: as a flex parent its children
          become flex items with min-width:auto, which lets a wide table grow
          past the panel instead of scrolling inside its own overflow-x box —
          the table then gets clipped by overflow-hidden and is unreachable on
          a phone. The chart gets its height from h-40, not from this. */}
      <div className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 px-4 py-3.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-zinc-800/70 animate-pulse" />
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Inbox size={18} className="text-zinc-700" />
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="text-xs text-zinc-600">Try a wider range or fewer filters.</p>
    </div>
  );
}

// Small affordance next to a row that already links somewhere — clicking it
// applies the row as a filter instead of navigating away.
function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded p-1 transition-colors cursor-pointer ${
        active ? "text-ember-300" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      <ListFilter size={13} />
    </button>
  );
}

const RANGE_LABELS: Record<StatsRange, string> = {
  "24h": "last 24h",
  "7d": "last 7d",
  "30d": "last 30d",
  "90d": "last 90d",
  all: "all time",
};

function CostTrend({ daily, range }: { daily?: DailyStatsRow[]; range: StatsRange }) {
  const max = Math.max(...(daily ?? []).map((d) => d.cost), 0.0001);
  return (
    <Panel title={`Cost · ${RANGE_LABELS[range]}`}>
      {!daily ? (
        <Skeleton rows={6} />
      ) : daily.length === 0 ? (
        <Empty label="No spend in this window." />
      ) : (
        <div className="flex flex-1 flex-col px-4 pt-4 pb-3">
          {/* h-40, not flex-1 + min-h-40: the bars are sized with percentage
              heights, and a percentage only resolves against a definite parent
              height. This row sits in an items-start grid, so the panel is not
              stretched and a min-height alone left every bar at 0px. */}
          <div className="flex items-end gap-1 h-40">
            {daily.map((d) => (
              <div
                key={d.day}
                className="flex-1 min-w-0 rounded-t bg-ember-500/70 hover:bg-ember-400 transition-colors"
                style={{ height: `${Math.max(2, (d.cost / max) * 100)}%` }}
                title={`${d.day} · ${formatCost(d.cost)} · ${d.reviews} review${d.reviews === 1 ? "" : "s"}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[0.7rem] text-zinc-600 tabular-nums">
            <span>{daily[0].day}</span>
            <span>{formatCost(max)} peak</span>
            <span>{daily[daily.length - 1].day}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ProjectStats({
  projects,
  active,
  onFilter,
}: {
  projects?: ProjectStatsRow[];
  active?: string;
  onFilter: (repo: string | undefined) => void;
}) {
  return (
    <Panel title="Cost by project">
      {!projects ? (
        <Skeleton />
      ) : projects.length === 0 ? (
        <Empty label="No reviews for these filters." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-right">Avg time</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const [owner, name] = p.repo_full_name.split("/");
                const isActive = active === p.repo_full_name;
                return (
                  <TableRow key={p.repo_full_name} className={isActive ? "bg-ember-950/25" : ""}>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        {owner && name ? (
                          <Link
                            to="/repos/$owner/$name"
                            params={{ owner, name }}
                            className="font-mono text-zinc-200 hover:text-ember-300"
                          >
                            {p.repo_full_name}
                          </Link>
                        ) : (
                          <span className="font-mono text-zinc-200">{p.repo_full_name}</span>
                        )}
                        <FilterButton
                          label={
                            isActive
                              ? `Clear repository filter ${p.repo_full_name}`
                              : `Filter by repository ${p.repo_full_name}`
                          }
                          active={isActive}
                          onClick={() => onFilter(isActive ? undefined : p.repo_full_name)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                      {p.reviews}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                      {formatSeconds(p.avg_duration) ?? "—"}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                      {formatTokens(p.tokens) ?? "—"}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-200">
                      {formatCost(p.cost) ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function ModelStats({
  models,
  active,
  onFilter,
}: {
  models?: ModelStatsRow[];
  active?: string;
  onFilter: (model: string | undefined) => void;
}) {
  return (
    <Panel title="Cost by model">
      {!models ? (
        <Skeleton />
      ) : models.length === 0 ? (
        <Empty label="No models for these filters." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => {
                const isActive = active === m.model;
                return (
                  <TableRow key={m.model} className={isActive ? "bg-ember-950/25" : ""}>
                    <TableCell className="py-2.5">
                      {/* No detail page for a model, so the whole name is the filter. */}
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => onFilter(isActive ? undefined : m.model)}
                        className={`font-mono text-left transition-colors cursor-pointer ${
                          isActive ? "text-ember-300" : "text-zinc-200 hover:text-ember-300"
                        }`}
                      >
                        {m.model}
                      </button>
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                      {m.reviews}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                      {formatTokens(m.tokens) ?? "—"}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-zinc-200">
                      {formatCost(m.cost) ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function TopCost({ rows }: { rows?: Stats["topCost"] }) {
  return (
    <Panel title="Most expensive reviews">
      {!rows ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <Empty label="Nothing costed yet." />
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to="/reviews/$id"
                params={{ id: String(r.id) }}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-zinc-200 truncate">
                    {r.repo_full_name}
                    {r.pr_number > 0 ? `#${r.pr_number}` : ""}
                  </div>
                  {r.model && <div className="text-xs text-zinc-500 truncate">{r.model}</div>}
                </div>
                {r.tokens != null && (
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums w-14 text-right">
                    {formatTokens(r.tokens)}
                  </span>
                )}
                <span className="shrink-0 text-sm text-zinc-100 tabular-nums w-16 text-right">
                  {formatCost(r.cost)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const TRIGGER_COLORS = ["bg-ember-400", "bg-sky-400", "bg-violet-400", "bg-amber-400", "bg-zinc-500"];

function MixBar({
  items,
}: {
  items: { key: string; label: string; count: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="px-4 py-3.5 space-y-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        {items.map((i) => (
          <div
            key={i.key}
            className={i.color}
            style={{ width: `${(i.count / total) * 100}%` }}
            title={`${i.label}: ${i.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">
        {items.map((i) => (
          <span key={i.key} className="flex items-center gap-1.5 tabular-nums">
            <span className={`h-2 w-2 rounded-full ${i.color}`} />
            {i.label}
            <span className="text-zinc-600">{i.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TriggerMix({ triggers }: { triggers?: TriggerStatsRow[] }) {
  const items = (triggers ?? []).map((t, i) => ({
    key: t.trigger,
    label: triggerLabel(t.trigger) ?? t.trigger,
    count: t.count,
    color: TRIGGER_COLORS[i % TRIGGER_COLORS.length],
  }));
  return (
    <Panel title="How reviews start">
      {!triggers ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        <Empty label="No triggers recorded." />
      ) : (
        <MixBar items={items} />
      )}
    </Panel>
  );
}

// Same palette as the review view: blocking = alarm, question = ask, nit = muted.
const SEVERITY_COLORS: Record<string, string> = {
  blocking: "bg-red-400",
  question: "bg-amber-400",
  nit: "bg-zinc-500",
};

function SeverityMix({ severity }: { severity?: SeverityStatsRow[] }) {
  const items = (severity ?? []).map((s) => ({
    key: s.severity,
    label: s.severity,
    count: s.count,
    color: SEVERITY_COLORS[s.severity] ?? "bg-zinc-500",
  }));
  return (
    <Panel title="Findings by severity">
      {!severity ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        <Empty label="No findings yet." />
      ) : (
        <MixBar items={items} />
      )}
    </Panel>
  );
}

function Reviews({ rows, pending }: { rows?: ReviewRow[]; pending: boolean }) {
  return (
    <Panel title="Reviews">
      {pending || !rows ? (
        <Skeleton rows={6} />
      ) : rows.length === 0 ? (
        <Empty label="No reviews match these filters." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Took</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="py-2.5 tabular-nums text-zinc-500">{r.id}</TableCell>
                  <TableCell className="py-2.5">
                    <Link
                      to="/reviews/$id"
                      params={{ id: String(r.id) }}
                      className="font-mono text-zinc-200 hover:text-ember-300 whitespace-nowrap"
                    >
                      {r.repo_full_name}
                      {r.pr_number > 0 ? `#${r.pr_number}` : ""}
                    </Link>
                    {r.model && <div className="text-xs text-zinc-600 truncate">{r.model}</div>}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge status={r.status} />
                  </TableCell>
                  <TableCell className="py-2.5 text-zinc-400 text-xs">
                    {triggerLabel(r.trigger) ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums text-zinc-400">
                    {r.completed_at
                      ? (formatSeconds(r.completed_at - r.created_at) ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums text-zinc-200">
                    {formatCost(r.cost) ?? "—"}
                  </TableCell>
                  <TableCell
                    className="py-2.5 text-right tabular-nums text-zinc-500 whitespace-nowrap"
                    title={new Date(r.created_at * 1000).toLocaleString()}
                  >
                    {timeAgo(r.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
