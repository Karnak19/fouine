import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  api,
  type DailyStatsRow,
  type ModelStatsRow,
  type ProjectStatsRow,
  type ReviewRow,
  type SeverityStatsRow,
  type Stats,
  type TriggerStatsRow,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatSeconds, formatTokens, timeAgo, triggerLabel } from "@/lib/format";
import { Inbox } from "lucide-react";

const DAY_S = 24 * 60 * 60;

export default function DashboardPage() {
  const { data: reviews, isPending } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list,
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats.get,
  });

  const now = Date.now() / 1000;
  const all = reviews ?? [];
  const inFlight = all.filter((r) => r.status === "running" || r.status === "pending");
  const last24h = all.filter((r) => r.created_at >= now - DAY_S);
  const done24 = last24h.filter((r) => r.status === "completed");
  const failed24 = last24h.filter((r) => r.status === "failed");
  const finished24 = done24.length + failed24.length;
  const successRate = finished24 ? Math.round((done24.length / finished24) * 100) : null;
  const cost24 = last24h.length ? last24h.reduce((sum, r) => sum + (r.cost ?? 0), 0) : null;
  // In-flight already has its own panel above; keep the feed to finished work.
  const recent = all.filter((r) => r.status !== "running" && r.status !== "pending").slice(0, 25);

  // The two distribution bars: stacked in one column beside "Running now" when
  // something's in flight, else laid out as two side-by-side grid cells.
  const severityMix = stats && stats.severity.length > 0 ? <SeverityMix severity={stats.severity} /> : null;
  const triggerMix = stats && stats.triggers.length > 0 ? <TriggerMix triggers={stats.triggers} /> : null;
  const hasMix = Boolean(severityMix || triggerMix);

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">What fouine is doing, latest first.</p>
        </div>
        {inFlight.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-ember-300 tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[fouine-pulse_1.4s_ease-in-out_infinite]" />
            live · every 5s
          </span>
        )}
      </div>

      {/* The two KPI strips are short — stack them on the left and let the 30-day
          cost chart stretch to their combined height beside them (default grid
          `stretch`, and CostTrend grows its bar area to fill). */}
      <div className="grid gap-7 lg:grid-cols-2">
        <div className="space-y-7">
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-zinc-800 divide-x divide-y sm:divide-y-0 divide-zinc-800 overflow-hidden bg-zinc-900/40">
            <Stat
              label="In flight"
              value={isPending ? null : String(inFlight.length)}
              accent={inFlight.length > 0}
              pulse={inFlight.length > 0}
            />
            <Stat
              label="Success · 24h"
              value={isPending ? null : successRate == null ? "—" : `${successRate}%`}
              sub={failed24.length ? `${failed24.length} failed` : finished24 ? "all clean" : undefined}
            />
            <Stat label="Cost · 24h" value={isPending ? null : formatCost(cost24) ?? "—"} />
            <Stat label="Reviews · 24h" value={isPending ? null : String(last24h.length)} />
          </div>
          {stats && <AggregateStats stats={stats} />}
        </div>
        {stats && stats.daily.length > 0 && <CostTrend daily={stats.daily} />}
      </div>

      {/* Anything in flight takes the left column with the distribution bars
          stacked on the right; when nothing's running the bars sit side by side. */}
      {(inFlight.length > 0 || hasMix) && (
        <div className="grid gap-7 lg:grid-cols-2 items-start">
          {inFlight.length > 0 && (
            // Span both columns when nothing sits beside it, else it's half-width.
            <section
              className={`rounded-lg border border-ember-800/50 bg-ember-950/25 overflow-hidden ${!hasMix ? "lg:col-span-2" : ""}`}
            >
              <h2 className="px-4 pt-3 pb-2.5 text-xs font-medium uppercase tracking-wide text-ember-300/90">
                Running now
              </h2>
              <ul className="divide-y divide-ember-800/25">
                {inFlight.map((r) => (
                  <ActivityRow key={r.id} r={r} />
                ))}
              </ul>
            </section>
          )}
          {hasMix &&
            (inFlight.length > 0 ? (
              <div className="space-y-7">
                {severityMix}
                {triggerMix}
              </div>
            ) : (
              <>
                {severityMix}
                {triggerMix}
              </>
            ))}
        </div>
      )}

      {stats && (stats.projects.length > 0 || stats.models.length > 0 || stats.topCost.length > 0) && (
        <div className="grid gap-7 lg:grid-cols-2 items-start">
          {/* The 5-col project table is wide by nature — span both columns; the
              model table + expensive list pair up beside each other. */}
          {stats.projects.length > 0 && (
            <div className="lg:col-span-2">
              <ProjectStats projects={stats.projects} />
            </div>
          )}
          {stats.models.length > 0 && <ModelStats models={stats.models} />}
          {stats.topCost.length > 0 && <TopCost rows={stats.topCost} />}
        </div>
      )}

      <section className="space-y-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent activity</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          {isPending ? (
            <SkeletonRows />
          ) : recent.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {recent.map((r) => (
                <ActivityRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function AggregateStats({ stats }: { stats: Stats }) {
  const totalCost = stats.projects.reduce((s, p) => s + p.cost, 0);
  const avgCost = stats.latency.count ? totalCost / stats.latency.count : null;
  const triggerTotal = stats.triggers.reduce((s, t) => s + t.count, 0);
  const retries = stats.triggers.find((t) => t.trigger === "retry")?.count ?? 0;
  const retryRate = triggerTotal ? Math.round((retries / triggerTotal) * 100) : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-zinc-800 divide-x divide-y sm:divide-y-0 divide-zinc-800 overflow-hidden bg-zinc-900/40">
      <Stat label="Avg review" value={formatSeconds(stats.latency.avg) ?? "—"} />
      <Stat
        label="p95 review"
        value={formatSeconds(stats.latency.p95) ?? "—"}
        sub={stats.latency.count ? `${stats.latency.count} done` : undefined}
      />
      <Stat label="Avg cost / review" value={formatCost(avgCost) ?? "—"} />
      <Stat
        label="Retry rate"
        value={retryRate == null ? "—" : `${retryRate}%`}
        sub={retries ? `${retries} retried` : undefined}
      />
    </div>
  );
}

function CostTrend({ daily }: { daily: DailyStatsRow[] }) {
  const max = Math.max(...daily.map((d) => d.cost), 0.0001);
  return (
    <section className="flex flex-col space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Cost · last 30d</h2>
      <div className="flex flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 pt-4 pb-3">
        <div className="flex items-end gap-1 flex-1 min-h-24">
          {daily.map((d) => (
            <div
              key={d.day}
              className="flex-1 min-w-0 rounded-t bg-ember-500/70 hover:bg-ember-400 transition-colors"
              style={{ height: `${Math.max(2, (d.cost / max) * 100)}%` }}
              title={`${d.day} · ${formatCost(d.cost)} · ${d.reviews} review${d.reviews === 1 ? "" : "s"}`}
            />
          ))}
        </div>
        {daily.length > 0 && (
          <div className="mt-2 flex justify-between text-[0.7rem] text-zinc-600 tabular-nums">
            <span>{daily[0].day}</span>
            <span>{daily[daily.length - 1].day}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectStats({ projects }: { projects: ProjectStatsRow[] }) {
  const totals = projects.reduce(
    (acc, p) => {
      acc.reviews += p.reviews;
      acc.cost += p.cost;
      acc.tokens += p.tokens;
      return acc;
    },
    { reviews: 0, cost: 0, tokens: 0 },
  );

  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Cost by project</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
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
              return (
                <TableRow key={p.repo_full_name}>
                  <TableCell className="py-2.5 font-mono text-zinc-200">
                    {owner && name ? (
                      <Link
                        to="/repos/$owner/$name"
                        params={{ owner, name }}
                        className="hover:text-ember-300"
                      >
                        {p.repo_full_name}
                      </Link>
                    ) : (
                      p.repo_full_name
                    )}
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
          {projects.length > 1 && (
            <tfoot className="border-t border-zinc-800">
              <TableRow className="hover:bg-transparent">
                <TableCell className="py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Total
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums text-zinc-300">
                  {totals.reviews}
                </TableCell>
                <TableCell />
                <TableCell className="py-2.5 text-right tabular-nums text-zinc-300">
                  {formatTokens(totals.tokens) ?? "—"}
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums text-zinc-100 font-semibold">
                  {formatCost(totals.cost) ?? "—"}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </section>
  );
}

function ModelStats({ models }: { models: ModelStatsRow[] }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Cost by model</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
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
            {models.map((m) => (
              <TableRow key={m.model}>
                <TableCell className="py-2.5 font-mono text-zinc-200">{m.model}</TableCell>
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
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function TopCost({ rows }: { rows: Stats["topCost"] }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Most expensive reviews
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
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
      </div>
    </section>
  );
}

const TRIGGER_COLORS = ["bg-ember-400", "bg-sky-400", "bg-violet-400", "bg-amber-400", "bg-zinc-500"];

function TriggerMix({ triggers }: { triggers: TriggerStatsRow[] }) {
  const total = triggers.reduce((s, t) => s + t.count, 0);
  if (!total) return null;
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">How reviews start</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3.5 space-y-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
          {triggers.map((t, i) => (
            <div
              key={t.trigger}
              className={TRIGGER_COLORS[i % TRIGGER_COLORS.length]}
              style={{ width: `${(t.count / total) * 100}%` }}
              title={`${triggerLabel(t.trigger) ?? t.trigger}: ${t.count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">
          {triggers.map((t, i) => (
            <span key={t.trigger} className="flex items-center gap-1.5 tabular-nums">
              <span
                className={`h-2 w-2 rounded-full ${TRIGGER_COLORS[i % TRIGGER_COLORS.length]}`}
              />
              {triggerLabel(t.trigger) ?? t.trigger}
              <span className="text-zinc-600">{t.count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// blocking = alarm, question = ask, nit = muted — same palette as the review view.
const SEVERITY_META: Record<string, { label: string; dot: string }> = {
  blocking: { label: "blocking", dot: "bg-red-400" },
  question: { label: "question", dot: "bg-amber-400" },
  nit: { label: "nit", dot: "bg-zinc-500" },
};

function SeverityMix({ severity }: { severity: SeverityStatsRow[] }) {
  const total = severity.reduce((s, x) => s + x.count, 0);
  if (!total) return null;
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Findings by severity
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3.5 space-y-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
          {severity.map((x) => (
            <div
              key={x.severity}
              className={SEVERITY_META[x.severity]?.dot ?? "bg-zinc-500"}
              style={{ width: `${(x.count / total) * 100}%` }}
              title={`${SEVERITY_META[x.severity]?.label ?? x.severity}: ${x.count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">
          {severity.map((x) => (
            <span key={x.severity} className="flex items-center gap-1.5 tabular-nums">
              <span className={`h-2 w-2 rounded-full ${SEVERITY_META[x.severity]?.dot ?? "bg-zinc-500"}`} />
              {SEVERITY_META[x.severity]?.label ?? x.severity}
              <span className="text-zinc-600">{x.count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ r }: { r: ReviewRow }) {
  const trigger = triggerLabel(r.trigger);
  const cost = formatCost(r.cost);
  return (
    <li>
      <Link
        to="/reviews/$id"
        params={{ id: String(r.id) }}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40"
      >
        <Badge status={r.status} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm text-zinc-200 truncate">
            {r.repo_full_name}
            {r.pr_number > 0 ? `#${r.pr_number}` : ""}
          </div>
          {r.title && <div className="text-xs text-zinc-500 truncate">{r.title}</div>}
        </div>
        {trigger && (
          <span className="hidden sm:inline shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[0.7rem] text-zinc-400">
            {trigger}
          </span>
        )}
        {cost && <span className="shrink-0 text-xs text-zinc-500 tabular-nums w-14 text-right">{cost}</span>}
        <span
          className="shrink-0 text-xs text-zinc-500 tabular-nums w-16 text-right"
          title={new Date(r.created_at * 1000).toLocaleString()}
        >
          {timeAgo(r.created_at)}
        </span>
      </Link>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul className="divide-y divide-zinc-800/70">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-5 w-16 rounded-full bg-zinc-800/70 animate-pulse" />
          <div className="h-4 flex-1 max-w-64 rounded bg-zinc-800/70 animate-pulse" />
          <div className="h-4 w-12 rounded bg-zinc-800/70 animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox size={20} className="text-zinc-700" />
      <p className="text-sm text-zinc-400">No reviews yet.</p>
      <p className="text-xs text-zinc-600 max-w-xs">
        Enable a repo, then open a PR or comment <span className="font-mono text-zinc-500">/review</span> to
        kick off the first one.
      </p>
    </div>
  );
}
