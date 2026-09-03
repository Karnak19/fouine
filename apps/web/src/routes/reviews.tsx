import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { api, type ReviewRow } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, GitPullRequest, SlidersHorizontal, X } from "lucide-react";
import { RANGES, STATUSES } from "@/lib/stats-search";
import { validateReviewsSearch, type ReviewsSearch } from "@/lib/reviews-search";

// The server caps limit at 1000; we ask for a generous-but-bounded page and
// tell the operator when they've hit it rather than silently truncating.
const LIMIT = 200;

export default function ReviewsPage() {
  const search = useSearch({ strict: false }) as ReviewsSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: liveStatus, resync } = useLiveEvents(null, (e) => {
    if (e.type === "review:created" || e.type === "review:updated") {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    }
  });
  useEffect(() => {
    if (resync > 0) queryClient.invalidateQueries({ queryKey: ["reviews"] });
  }, [resync, queryClient]);

  const filters = { status: search.status, repo: search.repo, range: search.range, limit: LIMIT };
  const filtered = Boolean(search.status || search.repo || search.range);

  const setFilters = (patch: ReviewsSearch) =>
    navigate({
      to: "/reviews",
      search: (prev: Record<string, unknown>) => validateReviewsSearch({ ...prev, ...patch }),
    });

  const {
    data: reviews,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["reviews", filters],
    queryFn: () => api.reviews.query(filters),
  });
  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: api.repos.list });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
          <p className="text-sm text-zinc-500 mt-1">Every review fouine has run, newest first.</p>
        </div>
        <LiveBadge status={liveStatus} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <SlidersHorizontal size={14} className="text-zinc-500 shrink-0" />
        <Select
          label="Review status"
          value={search.status ?? ""}
          onChange={(v) => setFilters({ status: (v || undefined) as ReviewsSearch["status"] })}
          options={[...STATUSES]}
          placeholder="Any status"
        />
        <Select
          label="Repository"
          value={search.repo ?? ""}
          onChange={(v) => setFilters({ repo: v || undefined })}
          options={(repos ?? []).map((r) => r.full_name)}
          placeholder="All repositories"
        />
        <Select
          label="Time range"
          value={search.range ?? ""}
          onChange={(v) => setFilters({ range: (v || undefined) as ReviewsSearch["range"] })}
          options={[...RANGES]}
          placeholder="All time"
        />
        {filtered && (
          <button
            type="button"
            onClick={() => navigate({ to: "/reviews", search: {} })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 cursor-pointer"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <ReviewSkeleton />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !reviews?.length ? (
        <EmptyState filtered={filtered} />
      ) : (
        <div className="space-y-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>PR</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <ReviewTableRow key={r.id} r={r} />
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-zinc-500 px-1">
            {reviews.length === LIMIT
              ? `Showing the ${LIMIT} most recent — narrow with filters.`
              : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`}
          </p>
        </div>
      )}
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

function ReviewTableRow({ r }: { r: ReviewRow }) {
  const [owner, name] = r.repo_full_name.split("/");
  const errorLine = r.status === "failed" ? r.error?.split("\n")[0] : undefined;

  return (
    <TableRow className="relative">
      <TableCell className="text-zinc-500 tabular-nums">{r.id}</TableCell>
      <TableCell className="font-mono text-sm text-zinc-200 relative z-10">
        <Link to="/repos/$owner/$name" params={{ owner, name }} className="hover:text-zinc-100">
          {r.repo_full_name}
        </Link>
      </TableCell>
      <TableCell>
        {r.trigger === "improve" ? (
          <span className="text-sm text-zinc-400">improver</span>
        ) : (
          <div className="flex items-center gap-1.5 relative z-10">
            <Link
              to="/repos/$owner/$name/pr/$number"
              params={{ owner, name, number: String(r.pr_number) }}
              className="text-sm text-zinc-300 hover:text-zinc-100 tabular-nums"
            >
              #{r.pr_number}
            </Link>
            <a
              href={`https://github.com/${owner}/${name}/pull/${r.pr_number}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open PR #${r.pr_number} on GitHub`}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </TableCell>
      <TableCell className="max-w-[28rem]">
        <Link
          to="/reviews/$id"
          params={{ id: String(r.id) }}
          title={r.title ?? undefined}
          className="block truncate text-sm text-zinc-300 after:absolute after:inset-0"
        >
          {r.title ?? "—"}
        </Link>
        {errorLine && <p className="text-xs text-red-300/80 truncate">{errorLine}</p>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Badge status={r.status} />
          {r.attempt > 0 && <span className="text-[10px] text-zinc-500">retry</span>}
        </div>
      </TableCell>
      <TableCell
        className="text-zinc-500 text-sm text-right tabular-nums"
        title={new Date(r.created_at * 1000).toLocaleString()}
      >
        {timeAgo(r.created_at)}
      </TableCell>
    </TableRow>
  );
}

// Mirrors the real table's column count and header so loading → loaded
// doesn't jump: same Table/TableRow/TableCell padding, just pulsing bars
// standing in for text.
function ReviewSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Repository</TableHead>
          <TableHead>PR</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <div className="h-4 w-4 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-32 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-10 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
            <TableCell>
              <div className="h-4 w-56 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
            <TableCell>
              <div className="h-5 w-20 rounded-full bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
            <TableCell className="text-right">
              <div className="ml-auto h-4 w-16 rounded bg-zinc-800/70 animate-pulse motion-reduce:animate-none" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
      <p className="text-sm text-zinc-500">Couldn't load reviews.</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const navigate = useNavigate();
  if (filtered) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
        <GitPullRequest size={28} className="text-zinc-700" />
        <p className="mt-3 text-sm text-zinc-400">No reviews match these filters</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => navigate({ to: "/reviews", search: {} })}
        >
          Clear filters
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
      <GitPullRequest size={28} className="text-zinc-700" />
      <p className="mt-3 text-sm text-zinc-400">No reviews yet</p>
      <p className="text-xs text-zinc-500 mt-1">
        Comment <code className="text-zinc-500">/fouine</code> on a PR to kick one off.
      </p>
    </div>
  );
}
