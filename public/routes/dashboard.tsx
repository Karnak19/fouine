import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ReviewRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { formatCost, timeAgo, triggerLabel } from "@/lib/format";
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

  const now = Date.now() / 1000;
  const all = reviews ?? [];
  const inFlight = all.filter((r) => r.status === "running" || r.status === "pending");
  const last24h = all.filter((r) => r.created_at >= now - DAY_S);
  const done24 = last24h.filter((r) => r.status === "completed");
  const failed24 = last24h.filter((r) => r.status === "failed");
  const finished24 = done24.length + failed24.length;
  const successRate = finished24 ? Math.round((done24.length / finished24) * 100) : null;
  const cost24 = last24h.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  // In-flight already has its own panel above; keep the feed to finished work.
  const recent = all.filter((r) => r.status !== "running" && r.status !== "pending").slice(0, 25);

  return (
    <div className="space-y-7 max-w-4xl">
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
        <Stat
          label="Cost · 24h"
          value={isPending ? null : formatCost(cost24) ?? "—"}
        />
        <Stat
          label="Reviews · 24h"
          value={isPending ? null : String(last24h.length)}
        />
      </div>

      {inFlight.length > 0 && (
        <section className="rounded-lg border border-ember-800/50 bg-ember-950/25 overflow-hidden">
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

function Stat({
  label,
  value,
  sub,
  accent,
  pulse,
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent?: boolean;
  pulse?: boolean;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-zinc-500">
        {pulse && (
          <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[fouine-pulse_1.4s_ease-in-out_infinite]" />
        )}
        {label}
      </div>
      {value == null ? (
        <div className="mt-1.5 h-7 w-12 rounded bg-zinc-800/70 animate-pulse" />
      ) : (
        <div
          className={`mt-0.5 text-2xl font-semibold tabular-nums ${accent ? "text-ember-300" : "text-zinc-100"}`}
        >
          {value}
        </div>
      )}
      {sub && <div className="text-xs text-zinc-500 tabular-nums">{sub}</div>}
    </div>
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
            {r.repo_full_name}#{r.pr_number}
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
