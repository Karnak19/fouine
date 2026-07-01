import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api, type ReviewRow } from "@/lib/api";
import { timeAgo, duration, triggerLabel, formatCost, formatTokens } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, ChevronRight, RotateCw, Square, History } from "lucide-react";

export default function PRDetailPage() {
  const { owner, name, number } = useParams({ from: "/repos/$owner/$name/pr/$number" });
  const prNumber = Number(number);
  const queryClient = useQueryClient();
  const queryKey = ["repos", owner, name, "pr", prNumber];

  const { data: reviews, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.repos.prReviews(owner, name, prNumber),
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    },
  });

  const latest = reviews?.[0];
  const totals = reviews?.reduce(
    (acc, r) => {
      if (r.cost != null) acc.cost += r.cost;
      if (r.tokens != null) acc.tokens += r.tokens;
      return acc;
    },
    { cost: 0, tokens: 0 },
  );
  const hasCost = totals != null && reviews!.some((r) => r.cost != null);

  const retryMut = useMutation({
    mutationFn: () => {
      if (!latest) throw new Error("no review");
      return api.reviews.retry(latest.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const stopMut = useMutation({
    mutationFn: () => {
      if (!latest) throw new Error("no review");
      return api.reviews.stop(latest.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-32 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="/repos/$owner/$name"
        params={{ owner, name }}
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> {owner}/{name}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">
            {latest?.title ?? `PR #${prNumber}`}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
            <a
              href={`https://github.com/${owner}/${name}/pull/${prNumber}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-zinc-400 hover:text-zinc-200"
            >
              #{prNumber}
              <ExternalLink size={12} className="opacity-50" />
            </a>
            <span className="inline-flex items-center gap-1">
              <History size={12} />
              {reviews?.length ?? 0} review{(reviews?.length ?? 0) === 1 ? "" : "s"}
            </span>
            {hasCost && (
              <span className="tabular-nums">
                {formatCost(totals!.cost)}
                {totals!.tokens > 0 && (
                  <span className="text-zinc-600"> · {formatTokens(totals!.tokens)}</span>
                )}
              </span>
            )}
          </div>
        </div>
        {latest && (
          <div className="flex items-center gap-2 shrink-0">
            <Badge status={latest.status} />
            {(latest.status === "running" || latest.status === "pending") && (
              <Button
                variant="destructive"
                size="sm"
                disabled={stopMut.isPending}
                onClick={() => stopMut.mutate()}
              >
                <Square size={13} />
                Stop
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={
                retryMut.isPending || latest.status === "running" || latest.status === "pending"
              }
              onClick={() => retryMut.mutate()}
            >
              <RotateCw size={14} />
              Retry
            </Button>
          </div>
        )}
      </div>

      {reviews == null ? null : reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
          <History size={28} className="text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-400">No reviews for this PR yet.</p>
        </div>
      ) : (
        <ul className="rounded-lg border border-zinc-800 divide-y divide-zinc-900 overflow-hidden">
          {reviews.map((r) => (
            <TimelineRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineRow({ r }: { r: ReviewRow }) {
  const label = triggerLabel(r.trigger);
  return (
    <li>
      <Link
        to="/reviews/$id"
        params={{ id: String(r.id) }}
        className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/60 transition-colors"
      >
        <Badge status={r.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="font-mono text-zinc-500 tabular-nums">#{r.id}</span>
            {label && (
              <span className="text-xs text-zinc-500 rounded bg-zinc-800/60 px-1.5 py-0.5">
                {label}
              </span>
            )}
          </div>
          <div
            className="text-xs text-zinc-500 mt-0.5 tabular-nums"
            title={new Date(r.created_at * 1000).toLocaleString()}
          >
            {timeAgo(r.created_at)}
            {r.completed_at && (
              <span className="text-zinc-600"> · {duration(r.created_at, r.completed_at)}</span>
            )}
          </div>
        </div>
        {r.cost != null && (
          <span className="text-xs text-zinc-500 tabular-nums shrink-0">
            {formatCost(r.cost)}
            {r.tokens != null && r.tokens > 0 && (
              <span className="text-zinc-600"> · {formatTokens(r.tokens)}</span>
            )}
          </span>
        )}
        <ChevronRight size={16} className="text-zinc-600 shrink-0" />
      </Link>
    </li>
  );
}
