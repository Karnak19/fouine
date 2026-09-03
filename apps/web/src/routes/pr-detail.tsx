import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { api, type ReviewRow } from "@/lib/api";
import { timeAgo, duration, triggerLabel, formatCost, formatTokens } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { ArrowLeft, ExternalLink, ChevronRight, RotateCw, Square, History } from "lucide-react";
import { color, font, leading, radius, space, text, tracking } from "@/tokens.stylex";
import { shared } from "@/styles";

// Tailwind's `animate-pulse`. Restated locally because the @keyframes only
// exist while a className references the utility.
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

const s = stylex.create({
  // `space-y-*` is a `& > * + *` margin rule StyleX cannot express; a column
  // flex with the same gap renders identically for these block-level children.
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x768 },
  loadingPage: { display: "flex", flexDirection: "column", gap: space.x16, maxWidth: space.x768 },
  pulseBase: {
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  skeletonLine: { height: space.x16, width: space.x128, borderRadius: radius.base },
  skeletonBlock: { height: space.x128, borderRadius: radius.lg },

  headRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.x16 },
  headMain: { minWidth: 0 },
  titleRow: { minWidth: 0 },
  title: {
    fontSize: text.xl, lineHeight: leading.xl,
    fontWeight: 700,
    letterSpacing: tracking.tight
  },
  meta: {
    marginTop: space.x4,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.x12,
    rowGap: space.x4,
    fontSize: text.sm, lineHeight: leading.sm,
    color: color.zinc500
  },
  metaLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x4,
    fontFamily: font.mono,
    color: { default: color.zinc400, ":hover": color.zinc200 }
  },
  faded: { opacity: 0.5 },
  metaItem: { display: "inline-flex", alignItems: "center", gap: space.x4 },
  dim: { color: color.zinc600 },
  actions: { flexShrink: 0 },

  emptyIcon: { color: color.zinc700 },

  timeline: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    overflow: "hidden"
  },
  // `divide-y divide-zinc-900` lived on the <ul>; StyleX cannot reach children,
  // so each row draws its own top border and the first one opts out.
  timelineRow: {
    borderTopWidth: { default: 0, ":not(:first-child)": "1px" },
    borderTopStyle: "solid",
    borderTopColor: color.zinc900
  },
  rowLink: {
    display: "flex",
    alignItems: "center",
    gap: space.x12,
    paddingInline: space.x16,
    paddingBlock: space.x12,
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc900} 60%, transparent)`
    },
    transitionProperty: "color, background-color",
    transitionDuration: "150ms"
  },
  rowBody: { minWidth: 0, flexGrow: 1, flexBasis: 0 },
  rowTop: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc300 },
  rowId: { fontFamily: font.mono, color: color.zinc500 },
  trigger: {
    fontSize: text.xs, lineHeight: leading.xs,
    color: color.zinc500,
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 60%, transparent)`,
    paddingInline: space.x6,
    paddingBlock: space.x2
  },
  rowMeta: {
    fontSize: text.xs, lineHeight: leading.xs,
    color: color.zinc500,
    marginTop: space.x2
  },
  rowCost: {
    fontSize: text.xs, lineHeight: leading.xs,
    color: color.zinc500,
    flexShrink: 0
  },
  rowChevron: { color: color.zinc600, flexShrink: 0 }
});

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
    }
  });

  // Scoped to this repo. Review events don't carry the PR number, so any
  // review on this repo refetches — cheap, and the REST list stays the truth.
  const { status, resync } = useLiveEvents(`${owner}/${name}`, (e) => {
    if (e.type === "review:created" || e.type === "review:updated" || e.type === "repo:removed") {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name, "pr", prNumber] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name, "pr", prNumber] });
    }
  }, [resync, owner, name, prNumber, queryClient]);

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });
  const stopMut = useMutation({
    mutationFn: () => {
      if (!latest) throw new Error("no review");
      return api.reviews.stop(latest.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  if (isLoading) {
    return (
      <div {...stylex.props(s.loadingPage)}>
        <div {...stylex.props(s.pulseBase, s.skeletonLine)} />
        <div {...stylex.props(s.pulseBase, s.skeletonBlock)} />
      </div>
    );
  }

  return (
    <div {...stylex.props(s.page)}>
      <Link to="/repos/$owner/$name" params={{ owner, name }} {...stylex.props(shared.backLink)}>
        <ArrowLeft size={14} /> {owner}/{name}
      </Link>

      <div {...stylex.props(s.headRow)}>
        <div {...stylex.props(s.headMain)}>
          <div {...stylex.props(shared.row, s.titleRow)}>
            <h1 {...stylex.props(shared.truncate, s.title)}>{latest?.title ?? `PR #${prNumber}`}</h1>
            <LiveBadge status={status} />
          </div>
          <div {...stylex.props(s.meta)}>
            <a
              href={`https://github.com/${owner}/${name}/pull/${prNumber}`}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(s.metaLink)}
            >
              #{prNumber}
              <ExternalLink size={12} {...stylex.props(s.faded)} />
            </a>
            <span {...stylex.props(s.metaItem)}>
              <History size={12} />
              {reviews?.length ?? 0} review{(reviews?.length ?? 0) === 1 ? "" : "s"}
            </span>
            {hasCost && (
              <span {...stylex.props(shared.tabular)}>
                {formatCost(totals!.cost)}
                {totals!.tokens > 0 && (
                  <span {...stylex.props(s.dim)}> · {formatTokens(totals!.tokens)}</span>
                )}
              </span>
            )}
          </div>
        </div>
        {latest && (
          <div {...stylex.props(shared.row, s.actions)}>
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
        <div {...stylex.props(shared.emptyBox)}>
          <History size={28} {...stylex.props(s.emptyIcon)} />
          <p {...stylex.props(shared.emptyTitle)}>No reviews for this PR yet.</p>
        </div>
      ) : (
        <ul {...stylex.props(s.timeline)}>
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
    <li {...stylex.props(s.timelineRow)}>
      <Link to="/reviews/$id" params={{ id: String(r.id) }} {...stylex.props(s.rowLink)}>
        <Badge status={r.status} />
        <div {...stylex.props(s.rowBody)}>
          <div {...stylex.props(shared.row, s.rowTop)}>
            <span {...stylex.props(shared.tabular, s.rowId)}>#{r.id}</span>
            {label && <span {...stylex.props(s.trigger)}>{label}</span>}
          </div>
          <div
            {...stylex.props(shared.tabular, s.rowMeta)}
            title={new Date(r.created_at * 1000).toLocaleString()}
          >
            {timeAgo(r.created_at)}
            {/* A skip has no meaningful duration — say why it exists instead. */}
            {r.status === "skipped" ? (
              <span {...stylex.props(s.dim)}> · unchanged diff — nothing new to review</span>
            ) : (
              r.completed_at && (
                <span {...stylex.props(s.dim)}> · {duration(r.created_at, r.completed_at)}</span>
              )
            )}
          </div>
        </div>
        {r.cost != null && (
          <span {...stylex.props(shared.tabular, s.rowCost)}>
            {formatCost(r.cost)}
            {r.tokens != null && r.tokens > 0 && (
              <span {...stylex.props(s.dim)}> · {formatTokens(r.tokens)}</span>
            )}
          </span>
        )}
        <ChevronRight size={16} {...stylex.props(s.rowChevron)} />
      </Link>
    </li>
  );
}
