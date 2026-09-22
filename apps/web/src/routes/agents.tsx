import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ReviewRow } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCost, formatSeconds, formatTokens, timeAgo } from "@/lib/format";
import { Bot } from "lucide-react";

// The page's four agents, in display order. Raw `trigger` values roll up into
// them: refine/implement/improve are their own agents, and everything else is
// review work (opened, push, reopened, /fouine, retry, ready_for_review).
type AgentKey = "refiner" | "implementer" | "improver" | "reviewer";

const AGENT_META: Record<AgentKey, { name: string; description: string }> = {
  refiner: {
    name: "Refiner",
    description: "Tidies newly opened issues so they are clear enough to build from.",
  },
  implementer: {
    name: "Implementer",
    description: "Implements issues carrying the ready label and opens a pull request.",
  },
  improver: {
    name: "Improver",
    description: "Revisits repos on its own schedule and follows up on past reviews.",
  },
  reviewer: {
    name: "Reviewer",
    description: "Reviews pull requests when they open, change, or get a /fouine comment.",
  },
};

function agentOf(trigger: string | null): AgentKey {
  if (trigger === "refine") return "refiner";
  if (trigger === "implement") return "implementer";
  if (trigger === "improve") return "improver";
  return "reviewer";
}

interface AgentSummary {
  key: AgentKey;
  count: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  skipped: number;
  cost: number;
  tokens: number;
  avgDuration: number | null;
  lastRunAt: number | null;
}

// Recent runs shown under the summary. Matches the reviews page's page size
// thinking: bounded, with a note when the cap is hit.
const RECENT_LIMIT = 30;

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { status: liveStatus, resync } = useLiveEvents(null, (e) => {
    if (e.type === "review:created" || e.type === "review:updated") {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    }
  }, [resync, queryClient]);

  const {
    data: agentsData,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.query({}),
    // While anything runs the counts go stale fast; poll until it settles.
    refetchInterval: (q) => {
      const rows = q.state.data?.agents;
      if (!rows) return false;
      return rows.some((a) => a.running > 0 || a.pending > 0) ? 5000 : false;
    },
  });

  const {
    data: recent,
    isLoading: recentLoading,
    isError: recentError,
    refetch: refetchRecent,
  } = useQuery({
    queryKey: ["reviews", { limit: RECENT_LIMIT }],
    queryFn: () => api.reviews.query({ limit: RECENT_LIMIT }),
  });

  // Roll the per-trigger rows up into the four agents. Counts/cost/tokens sum;
  // last run takes the max; avg duration weights each trigger's average by its
  // completed runs (exact for single-trigger agents, which is three of four).
  const summaries = useMemo<AgentSummary[]>(() => {
    const acc: Record<AgentKey, Omit<AgentSummary, "key" | "avgDuration"> & { durSum: number; durCount: number }> = {
      refiner: fresh(),
      implementer: fresh(),
      improver: fresh(),
      reviewer: fresh(),
    };
    function fresh() {
      return {
        count: 0,
        completed: 0,
        failed: 0,
        running: 0,
        pending: 0,
        skipped: 0,
        cost: 0,
        tokens: 0,
        durSum: 0,
        durCount: 0,
        lastRunAt: null as number | null,
      };
    }
    for (const row of agentsData?.agents ?? []) {
      const s = acc[agentOf(row.trigger)];
      s.count += row.count;
      s.completed += row.completed;
      s.failed += row.failed;
      s.running += row.running;
      s.pending += row.pending;
      s.skipped += row.skipped;
      s.cost += row.cost;
      s.tokens += row.tokens;
      if (row.avg_duration != null) {
        s.durSum += row.avg_duration * row.completed;
        s.durCount += row.completed;
      }
      if (s.lastRunAt == null || row.last_run_at > s.lastRunAt) s.lastRunAt = row.last_run_at;
    }
    return (Object.keys(AGENT_META) as AgentKey[]).map((key) => {
      const s = acc[key];
      return {
        key,
        count: s.count,
        completed: s.completed,
        failed: s.failed,
        running: s.running,
        pending: s.pending,
        skipped: s.skipped,
        cost: s.cost,
        tokens: s.tokens,
        avgDuration: s.durCount > 0 ? s.durSum / s.durCount : null,
        lastRunAt: s.lastRunAt,
      };
    });
  }, [agentsData]);

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-zinc-500 mt-1">Runs grouped by the agent that did them.</p>
        </div>
        <LiveBadge status={liveStatus} />
      </div>

      <section className="space-y-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Agents</h2>
        {agentsLoading ? (
          <AgentSkeleton />
        ) : agentsError ? (
          <ErrorState onRetry={() => void refetchAgents()} />
        ) : (
          // One bordered container with internal dividers — the stat-strip
          // discipline — not four repeated cards.
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800/70 overflow-hidden">
            {summaries.map((s) => (
              <AgentSection key={s.key} summary={s} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent runs</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          {recentLoading ? (
            <SkeletonRows />
          ) : recentError ? (
            <ErrorState onRetry={() => void refetchRecent()} />
          ) : !recent?.length ? (
            <EmptyRuns />
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {recent.map((r) => (
                <RunRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </div>
        {recent && recent.length > 0 && (
          <p className="text-xs text-zinc-500 px-1 tabular-nums">
            {recent.length === RECENT_LIMIT
              ? `Showing the ${RECENT_LIMIT} most recent runs.`
              : `${recent.length} recent run${recent.length === 1 ? "" : "s"}`}
          </p>
        )}
      </section>
    </div>
  );
}

function AgentSection({ summary }: { summary: AgentSummary }) {
  const meta = AGENT_META[summary.key];
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{meta.name}</h3>
        {summary.running > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ember-300 tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[fouine-pulse_1.4s_ease-in-out_infinite]" />
            {summary.running} running
          </span>
        )}
        {summary.lastRunAt != null && (
          <span
            className="ml-auto shrink-0 text-xs text-zinc-500 tabular-nums"
            title={new Date(summary.lastRunAt * 1000).toLocaleString()}
          >
            last run {timeAgo(summary.lastRunAt)}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-zinc-500">{meta.description}</p>
      {summary.count === 0 ? (
        <p className="mt-2 text-xs text-zinc-600">No runs yet.</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums sm:justify-between">
          {/* Spread across the row so wide viewports don't leave dead space
              between the stats and the last-run timestamp; wraps to the left
              on narrow screens where there is no room to spread. */}
          <span className="text-zinc-400">
            Runs <span className="text-zinc-200">{summary.count}</span>
          </span>
          <span className="text-zinc-400">
            Completed <span className="text-emerald-300">{summary.completed}</span>
          </span>
          <span className="text-zinc-400">
            Failed <span className="text-red-300">{summary.failed}</span>
          </span>
          {summary.pending > 0 && (
            <span className="text-zinc-400">
              Pending <span className="text-zinc-200">{summary.pending}</span>
            </span>
          )}
          {summary.skipped > 0 && (
            <span className="text-zinc-400">
              Skipped <span className="text-zinc-300">{summary.skipped}</span>
            </span>
          )}
          <span className="text-zinc-400">
            Cost <span className="text-zinc-200">{formatCost(summary.cost) ?? "—"}</span>
          </span>
          <span className="text-zinc-400">
            Tokens <span className="text-zinc-200">{formatTokens(summary.tokens) ?? "—"}</span>
          </span>
          <span className="text-zinc-400">
            Avg run <span className="text-zinc-200">{formatSeconds(summary.avgDuration) ?? "—"}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function RunRow({ r }: { r: ReviewRow }) {
  const cost = formatCost(r.cost);
  return (
    <li>
      <Link
        to="/reviews/$id"
        params={{ id: String(r.id) }}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/40"
      >
        {/* Fixed width fits the widest badge ("completed") so every title
            block shares one left edge, desktop and mobile. */}
        <span className="shrink-0 w-28">
          <Badge status={r.status} />
        </span>
        <div className="min-w-0 flex-1">
          {/* Repo name truncates first; the issue number always stays visible. */}
          <div className="flex min-w-0 items-baseline gap-1 font-mono text-sm text-zinc-200">
            <span className="truncate">{r.repo_full_name}</span>
            {r.pr_number > 0 && <span className="shrink-0">{`#${r.pr_number}`}</span>}
          </div>
          {r.title && <div className="text-xs text-zinc-500 truncate">{r.title}</div>}
        </div>
        {/* Same muted chip the dashboard uses for a run's trigger. */}
        <span className="hidden sm:inline shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[0.7rem] text-zinc-400">
          {AGENT_META[agentOf(r.trigger)].name}
        </span>
        {r.model && (
          <span className="hidden lg:inline shrink-0 max-w-44 truncate text-xs text-zinc-500">
            {r.model}
          </span>
        )}
        {cost && (
          <span className="shrink-0 text-xs text-zinc-500 tabular-nums w-14 text-right">{cost}</span>
        )}
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

// Same shape as the summary container (four divided rows) so loading → loaded
// doesn't jump: padding matches AgentSection, pulsing bars stand in for text.
function AgentSkeleton() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800/70 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="px-4 py-3.5 space-y-2">
          <div className="h-4 w-24 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-64 max-w-full rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
          <div className="flex gap-4 pt-1">
            <div className="h-3 w-16 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-20 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-14 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="divide-y divide-zinc-800/70">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="h-5 w-16 rounded-full bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
          <div className="h-4 flex-1 max-w-64 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-12 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
      <p className="text-sm text-zinc-500">Couldn't load agents.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyRuns() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Bot size={20} className="text-zinc-700" />
      <p className="text-sm text-zinc-400">No runs yet.</p>
      <p className="text-xs text-zinc-500 max-w-xs">
        Open a pull request or comment <span className="font-mono text-zinc-500">/fouine</span> to
        kick off the first one.
      </p>
    </div>
  );
}
