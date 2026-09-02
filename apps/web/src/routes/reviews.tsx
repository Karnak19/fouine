import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { api, type ReviewRow } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ExternalLink, GitPullRequest, ChevronRight } from "lucide-react";
import { color, font, leading, radius, space, text, tracking } from "@/tokens.stylex";

// Tailwind's `animate-pulse`. Restated locally because the @keyframes only
// exist while a className references the utility.
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

const s = stylex.create({
  // `space-y-6` is a `& > * + *` margin rule StyleX cannot express; a column
  // flex with the same gap renders identically for these block-level children.
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x896 },
  headRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.x16 },
  title: { fontSize: text.xl2, lineHeight: leading.xl2, fontWeight: 700, letterSpacing: tracking.tight },
  subtitle: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc500, marginTop: space.x4 },

  colNum: { width: space.x48 },
  colChevron: { width: space.x32 },
  alignRight: { textAlign: "right" },

  idCell: { color: color.zinc500, fontVariantNumeric: "tabular-nums" },
  repoCell: { fontFamily: font.mono, fontSize: text.sm, lineHeight: leading.sm, color: color.zinc200 },
  improver: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc400 },
  prRow: { display: "flex", alignItems: "center", gap: space.x6 },
  prLink: {
    fontSize: text.sm, lineHeight: leading.sm,
    color: { default: color.zinc300, ":hover": color.zinc100 },
    fontVariantNumeric: "tabular-nums"
  },
  extLink: { color: { default: color.zinc500, ":hover": color.zinc300 } },
  timeCell: { color: color.zinc500, fontSize: text.sm, lineHeight: leading.sm, textAlign: "right" },
  chevronCell: { color: color.zinc600 },

  skeletonList: { display: "flex", flexDirection: "column", gap: space.x8 },
  skeletonRow: {
    height: space.x40,
    borderRadius: radius.md,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: color.zinc800,
    paddingBlock: space.x64,
    textAlign: "center"
  },
  emptyIcon: { color: color.zinc700 },
  emptyTitle: { marginTop: space.x12, fontSize: text.sm, lineHeight: leading.sm, color: color.zinc400 },
  emptyHint: { fontSize: text.xs, lineHeight: leading.xs, color: color.zinc600, marginTop: space.x4 },
  emptyCode: { color: color.zinc500 }
});

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const { status, resync } = useLiveEvents(null, (e) => {
    if (e.type === "review:created" || e.type === "review:updated") {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    }
  });
  useEffect(() => {
    if (resync > 0) queryClient.invalidateQueries({ queryKey: ["reviews"] });
  }, [resync, queryClient]);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list
  });

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.headRow)}>
        <div>
          <h1 {...stylex.props(s.title)}>Reviews</h1>
          <p {...stylex.props(s.subtitle)}>Every review fouine has run, newest first.</p>
        </div>
        <LiveBadge status={status} />
      </div>

      {isLoading ? (
        <ReviewSkeleton />
      ) : !reviews?.length ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead style={s.colNum}>#</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>PR</TableHead>
              <TableHead>Status</TableHead>
              <TableHead style={s.alignRight}>Started</TableHead>
              <TableHead style={s.colChevron} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((r) => (
              <ReviewRow key={r.id} r={r} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ReviewRow({ r }: { r: ReviewRow }) {
  const [owner, name] = r.repo_full_name.split("/");
  return (
    <TableRow>
      <TableCell style={s.idCell}>{r.id}</TableCell>
      <TableCell style={s.repoCell}>{r.repo_full_name}</TableCell>
      <TableCell>
        {r.trigger === "improve" ? (
          <span {...stylex.props(s.improver)}>improver</span>
        ) : (
          <div {...stylex.props(s.prRow)}>
            <Link
              to="/repos/$owner/$name/pr/$number"
              params={{ owner, name, number: String(r.pr_number) }}
              {...stylex.props(s.prLink)}
            >
              #{r.pr_number}
            </Link>
            <a
              href={`https://github.com/${owner}/${name}/pull/${r.pr_number}`}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(s.extLink)}
            >
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </TableCell>
      <TableCell>
        <Badge status={r.status} />
      </TableCell>
      <TableCell style={s.timeCell} title={new Date(r.created_at * 1000).toLocaleString()}>
        {timeAgo(r.created_at)}
      </TableCell>
      <TableCell style={s.chevronCell}>
        <Link to="/reviews/$id" params={{ id: String(r.id) }}>
          <ChevronRight size={16} />
        </Link>
      </TableCell>
    </TableRow>
  );
}

function ReviewSkeleton() {
  return (
    <div {...stylex.props(s.skeletonList)}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} {...stylex.props(s.skeletonRow)} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div {...stylex.props(s.empty)}>
      <GitPullRequest size={28} {...stylex.props(s.emptyIcon)} />
      <p {...stylex.props(s.emptyTitle)}>No reviews yet</p>
      <p {...stylex.props(s.emptyHint)}>
        Comment <code {...stylex.props(s.emptyCode)}>/fouine</code> on a PR to kick one off.
      </p>
    </div>
  );
}
