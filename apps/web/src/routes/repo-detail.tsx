import { useState, useEffect, useMemo, type MouseEvent } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ReviewRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, ChevronRight, Play, FolderX, Settings, RotateCw, Inbox } from "lucide-react";
import { timeAgo, formatCost, formatSeconds } from "@/lib/format";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { cn } from "@/lib/utils";
import { Stat } from "@/components/stat";

// Improver runs pile up hourly, so the panel shows only the latest few by default.
const IMPROVER_RUNS_PREVIEW = 5;
// How long "Improver queued" stays up before the button is usable again.
const IMPROVER_QUEUED_MS = 5000;

export default function RepoDetailPage() {
  const { owner, name } = useParams({ from: "/repos/$owner/$name" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: repo,
    isError,
    refetch: refetchRepo,
  } = useQuery({
    queryKey: ["repos", owner, name],
    queryFn: () => api.repos.get(owner, name),
    retry: false,
  });

  const {
    data: reviews = [] as ReviewRow[],
    isError: reviewsError,
    refetch: refetchReviews,
  } = useQuery({
    queryKey: ["repos", owner, name, "reviews"],
    queryFn: () => api.repos.reviews(owner, name),
    // Fallback polling while a review runs, in case the SSE stream is down.
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    },
  });

  // Scoped to this repo: the server only sends events for it, so navigating
  // between repos re-subscribes cleanly (component instance persists across
  // param changes, the hook's scope key handles the swap).
  const { status, resync } = useLiveEvents(`${owner}/${name}`, (e) => {
    if (e.type === "review:created" || e.type === "review:updated") {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name, "reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
    // Removal too: another client deleting this repo must not leave us
    // rendering a row whose REST endpoint now 404s.
    if (e.type === "repo:updated" || e.type === "repo:removed") {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name, "reviews"] });
    }
  }, [resync, owner, name, queryClient]);

  // Improver runs ride the reviews table with trigger 'improve' (pr_number 0),
  // so split them out — they aren't PR reviews and get their own list.
  const improverRuns = useMemo(
    () => reviews.filter((r) => r.trigger === "improve"),
    [reviews],
  );
  const [showAllImprover, setShowAllImprover] = useState(false);
  const visibleImproverRuns = showAllImprover ? improverRuns : improverRuns.slice(0, IMPROVER_RUNS_PREVIEW);

  // Group PR reviews by PR — reviews come newest-first, so each group's head is
  // the latest run; groups sort by that latest run, newest PR activity first.
  // Refine rows share the PR-numbered column with the issue number, not an
  // actual PR, so they're excluded here too (reachable from /reviews instead).
  const prGroups = useMemo(() => {
    const map = new Map<number, ReviewRow[]>();
    for (const r of reviews) {
      if (r.trigger === "improve" || r.trigger === "refine" || r.trigger === "implement") continue;
      const arr = map.get(r.pr_number);
      if (arr) arr.push(r);
      else map.set(r.pr_number, [r]);
    }
    return [...map.values()].sort((a, b) => b[0].id - a[0].id);
  }, [reviews]);

  // Repo-level insight computed from the reviews we already fetch — same shape as
  // the dashboard's stat strip, scoped to this repo. Improver, refine and implement runs
  // don't count — neither is a PR review.
  const insight = useMemo(() => {
    const prReviews = reviews.filter(
      (r) => r.trigger !== "improve" && r.trigger !== "refine" && r.trigger !== "implement",
    );
    const completed = prReviews.filter((r) => r.status === "completed");
    const finished = completed.length + prReviews.filter((r) => r.status === "failed").length;
    const durations = completed
      .map((r) => (r.completed_at ?? 0) - r.created_at)
      .filter((d) => d > 0);
    return {
      count: prReviews.length,
      successRate: finished ? Math.round((completed.length / finished) * 100) : null,
      totalCost: prReviews.length ? prReviews.reduce((s, r) => s + (r.cost ?? 0), 0) : null,
      avgTime: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    };
  }, [reviews]);

  const improveMut = useMutation({
    mutationFn: () => api.repos.improve(owner, name),
    onError: (e: Error) => toast.error("Couldn't queue improver", { description: e.message }),
  });
  const resetImprove = improveMut.reset;
  // Reset after a few seconds, or as soon as the queued run shows up in the list.
  const newestImproverId = improverRuns[0]?.id;
  useEffect(() => {
    if (!improveMut.isSuccess) return;
    const t = setTimeout(resetImprove, IMPROVER_QUEUED_MS);
    return () => clearTimeout(t);
  }, [improveMut.isSuccess, resetImprove]);
  useEffect(() => {
    resetImprove();
  }, [newestImproverId, resetImprove]);

  const retryMut = useMutation({
    mutationFn: (id: number) => api.reviews.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name, "reviews"] });
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (e: Error) => toast.error("Couldn't retry review", { description: e.message }),
  });

  // One line answering "is it healthy": what is running, and whether the last
  // finished review failed. Reviews come newest-first.
  const running = reviews.filter((r) => r.status === "running" || r.status === "pending");
  // PRs whose latest run failed (a group's head is its latest run). Newest first.
  const failedPrs = prGroups.filter((g) => g[0].status === "failed");
  const lastFailed = failedPrs[0]?.[0];

  // A repo:removed refetch 404s, so distinguish gone from still-loading —
  // otherwise a deleted repo shimmers forever.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
        <FolderX size={28} className="text-zinc-700" />
        <p className="mt-3 text-sm text-zinc-400">
          {owner}/{name} is no longer registered
        </p>
        <Link to="/repos" className="mt-3 text-xs text-zinc-500 hover:text-zinc-300">
          Back to repositories
        </Link>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchRepo()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="space-y-6">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-8 w-64 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-64 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  const stopRow = (e: MouseEvent) => e.stopPropagation();
  const rowClass =
    "flex cursor-pointer items-center gap-2 px-4 sm:gap-3 py-2.5 transition-colors hover:bg-zinc-800/40";
  const panelLabel = "text-xs font-medium uppercase tracking-wide text-zinc-500";
  const panelBody = "rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden";

  return (
    <div className="min-w-0 space-y-7">
      <Link
        to="/repos"
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Repositories
      </Link>

      <div className="min-w-0">
        <div className="flex items-center gap-x-3">
          <h1 className="min-w-0 truncate text-2xl font-bold font-mono">{repo.full_name}</h1>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 tabular-nums",
              repo.enabled
                ? "bg-ember-950/50 text-ember-300 ring-ember-800/40"
                : "bg-zinc-800/60 text-zinc-400 ring-zinc-700/50",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", repo.enabled ? "bg-ember-400" : "bg-zinc-500")}
            />
            {repo.enabled ? "auto-review on" : "paused"}
          </span>
          <a
            href={`https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-300 focus-ring rounded-sm"
            aria-label="Open on GitHub"
          >
            <ExternalLink size={14} />
          </a>
          <LiveBadge status={status} />
          <Link
            to="/repos/$owner/$name/settings"
            params={{ owner, name }}
            aria-label="Settings"
            className="ml-auto inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-700 px-2 text-sm font-medium transition-colors hover:bg-zinc-800 focus-ring sm:px-3"
          >
            <Settings size={14} />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
        <p className="mt-2 text-sm text-zinc-400 tabular-nums">
          {running.length === 0 && failedPrs.length === 0 ? (
            reviews.length === 0 ? (
              "No reviews yet"
            ) : (
              "All recent reviews completed"
            )
          ) : (
            <>
              {running.length > 0 && (
                <Link
                  to="/reviews/$id"
                  params={{ id: String(running[0].id) }}
                  className="text-ember-300 hover:text-ember-200"
                >
                  {running.length} running
                </Link>
              )}
              {running.length > 0 && failedPrs.length > 0 && " · "}
              {lastFailed && (
                <Link
                  to="/reviews/$id"
                  params={{ id: String(lastFailed.id) }}
                  className="text-red-300 hover:text-red-200"
                >
                  {failedPrs.length} {failedPrs.length === 1 ? "PR" : "PRs"} failed
                </Link>
              )}
            </>
          )}
        </p>
      </div>

      {insight.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-zinc-800 divide-x divide-y sm:divide-y-0 divide-zinc-800 overflow-hidden bg-zinc-900/40">
          <Stat label="Reviews" value={String(insight.count)} />
          <Stat
            label="Success"
            title="Share of finished reviews that completed. Pending runs excluded."
            value={insight.successRate == null ? "n/a" : `${insight.successRate}%`}
          />
          <Stat label="Total cost" value={formatCost(insight.totalCost) ?? "n/a"} />
          <Stat label="Avg review" value={formatSeconds(insight.avgTime) ?? "n/a"} />
        </div>
      )}

      <section className="min-w-0 space-y-2.5">
        <h2 className={panelLabel}>Reviews by PR</h2>
        <div className={panelBody}>
          {reviewsError ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-zinc-500">Couldn't load reviews.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetchReviews()}
              >
                Retry
              </Button>
            </div>
          ) : prGroups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Inbox size={20} className="text-zinc-700" />
              <p className="text-sm text-zinc-400">No reviews yet.</p>
              <p className="text-xs text-zinc-500 max-w-xs">
                Open a PR or comment <span className="font-mono text-zinc-500">/fouine</span> to
                trigger one.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {prGroups.map((group) => {
                const latest = group[0];
                return (
                  <li
                    key={latest.pr_number}
                    className={rowClass}
                    onClick={() =>
                      navigate({
                        to: "/repos/$owner/$name/pr/$number",
                        params: { owner, name, number: String(latest.pr_number) },
                      })
                    }
                  >
                    <div className="flex w-16 shrink-0 items-center gap-1.5 sm:w-24">
                      <Link
                        to="/repos/$owner/$name/pr/$number"
                        params={{ owner, name, number: String(latest.pr_number) }}
                        onClick={stopRow}
                        className="font-mono text-sm text-zinc-200 hover:text-zinc-100 tabular-nums"
                      >
                        #{latest.pr_number}
                      </Link>
                      <a
                        href={`https://github.com/${owner}/${name}/pull/${latest.pr_number}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={stopRow}
                        className="text-zinc-500 hover:text-zinc-300"
                        aria-label={`Open PR #${latest.pr_number} on GitHub`}
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                    <span className="shrink-0 w-24 sm:w-28">
                      <Badge status={latest.status} />
                    </span>
                    {latest.status === "failed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        aria-label="Retry review"
                        disabled={retryMut.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          retryMut.mutate(latest.id);
                        }}
                      >
                        <RotateCw size={12} />
                        <span className="hidden sm:inline">Retry</span>
                      </Button>
                    )}
                    <span className="min-w-0 flex-1" />
                    <span className="hidden sm:block shrink-0 w-16 text-right text-xs text-zinc-500 tabular-nums whitespace-nowrap">
                      {group.length} {group.length === 1 ? "run" : "runs"}
                    </span>
                    <span
                      className="shrink-0 w-16 text-right text-xs text-zinc-500 tabular-nums whitespace-nowrap"
                      title={new Date(latest.created_at * 1000).toLocaleString()}
                    >
                      {timeAgo(latest.created_at)}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-zinc-500" aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="min-w-0 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className={panelLabel}>Improver runs</h2>
          <div className="flex items-center gap-2">
            {improverRuns.length > IMPROVER_RUNS_PREVIEW && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-zinc-400"
                onClick={() => setShowAllImprover((v) => !v)}
              >
                {showAllImprover ? "Show less" : `Show all ${improverRuns.length}`}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={improveMut.isPending || improveMut.isSuccess}
              onClick={() => improveMut.mutate()}
              title="Read human feedback on this repo's review threads and open a REVIEW.md PR"
            >
              <Play size={12} />
              {improveMut.isSuccess ? "Improver queued" : "Run improver"}
            </Button>
          </div>
        </div>
        <div className={panelBody}>
          {improverRuns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Inbox size={20} className="text-zinc-700" />
              <p className="text-sm text-zinc-400">No improver runs yet.</p>
              <p className="text-xs text-zinc-500 max-w-xs">
                It reads review feedback and opens a REVIEW.md PR.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {visibleImproverRuns.map((r) => (
                <li
                  key={r.id}
                  className={rowClass}
                  onClick={() => navigate({ to: "/reviews/$id", params: { id: String(r.id) } })}
                >
                  <div className="w-16 shrink-0 sm:w-24">
                    <Link
                      to="/reviews/$id"
                      params={{ id: String(r.id) }}
                      onClick={stopRow}
                      className="font-mono text-sm text-zinc-200 hover:text-zinc-100 tabular-nums"
                    >
                      #{r.id}
                    </Link>
                  </div>
                  <span className="shrink-0 w-24 sm:w-28">
                    <Badge status={r.status} />
                  </span>
                  <span className="min-w-0 flex-1" />
                  <span
                    className="shrink-0 w-16 text-right text-xs text-zinc-500 tabular-nums whitespace-nowrap"
                    title={new Date(r.created_at * 1000).toLocaleString()}
                  >
                    {timeAgo(r.created_at)}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-zinc-500" aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-xs text-zinc-500">
        Installation ID: {repo.installation_id}. Reviews run when a PR is opened, pushed to,
        reopened, or marked ready for review, and on a <span className="font-mono">/fouine</span>{" "}
        comment.
      </p>
    </div>
  );
}
