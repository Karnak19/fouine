import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { color, font, leading, radius, space, text, tracking } from "@/tokens.stylex";
import { shared } from "@/styles";
import {
  api,
  type DailyStatsRow,
  type ModelStatsRow,
  type ProjectStatsRow,
  type ReviewRow,
  type SeverityStatsRow,
  type Stats,
  type TriggerStatsRow
} from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatSeconds, formatTokens, timeAgo, triggerLabel } from "@/lib/format";
import { Inbox } from "lucide-react";

const DAY_S = 24 * 60 * 60;


// Tailwind's `animate-pulse`. Restated locally because the @keyframes only
// exist while some className references the utility. Not `fouine-pulse` — that
// one bottoms out at 0.35, this one at 0.5.
const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 }
});

const s = stylex.create({
  // space-y-7 as a flex column: children are full-width blocks either way.
  page: { display: "flex", flexDirection: "column", gap: space.x28 },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.x16
  },
  runningPill: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.ember300,
    fontVariantNumeric: "tabular-nums"
  },
  runningDot: {
    backgroundColor: color.ember400,
    // fouine-pulse lives in global.css — referenced by name so the two stay
    // in sync.
    animationName: "fouine-pulse",
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite"
  },
  grid2: {
    display: "grid",
    gap: space.x28,
    gridTemplateColumns: { default: null, "@media (min-width: 1024px)": "repeat(2, minmax(0, 1fr))" }
  },
  gridTop: { alignItems: "start" },
  column: { display: "flex", flexDirection: "column", gap: space.x28 },
  // KPI strip. `divide-x divide-y sm:divide-y-0` was a `& > :not(:last-child)`
  // rule on this container; StyleX can't reach children, so the hairline moves
  // onto each cell via <Stat style> (see `cell` below).
  strip: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", "@media (min-width: 640px)": "repeat(4, minmax(0, 1fr))" },
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    overflow: "hidden",
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`
  },
  // One KPI cell's share of the old `divide-*`: Tailwind v4 puts the line on
  // `:not(:last-child)` as a trailing border, hence inline-end + bottom rather
  // than start + top. `sm:divide-y-0` drops the horizontal line once the four
  // cells sit on one row.
  cell: {
    borderStyle: "solid",
    borderColor: color.zinc800,
    borderInlineEndWidth: { default: "1px", ":last-child": 0 },
    borderBottomWidth: { default: "1px", ":last-child": 0, "@media (min-width: 640px)": 0 }
  },
  running: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in oklab, ${color.ember800} 50%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color.ember950} 25%, transparent)`,
    overflow: "hidden"
  },
  // Span both columns when nothing sits beside it, else it's half-width.
  runningWide: { gridColumn: { default: null, "@media (min-width: 1024px)": "span 2 / span 2" } },
  runningTitle: {
    paddingInline: space.x16,
    paddingTop: space.x12,
    paddingBottom: space.x10,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: tracking.wide,
    color: `color-mix(in oklab, ${color.ember300} 90%, transparent)`
  },
  list: { display: "block" },
  sectionTitle: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: tracking.wide,
    color: color.zinc500
  },
  // space-y-2.5
  section: { display: "flex", flexDirection: "column", gap: space.x10 },
  card: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`,
    overflow: "hidden"
  },
  // The 5-col project table is wide by nature — span both columns.
  wide: { gridColumn: { default: null, "@media (min-width: 1024px)": "span 2 / span 2" } }
});

export default function DashboardPage() {
  const queryClient = useQueryClient();
  // SSE keeps the lists fresh the moment anything changes; the existing
  // refetchInterval stays as the fallback when the stream is down.
  const { status, resync } = useLiveEvents(null, (e) => {
    if (e.type === "review:created" || e.type === "review:updated") {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
    // Findings land after the review row is already final, and /stats derives
    // its severity counts from them — without this the KPIs lag a review.
    if (e.type === "review:findings") {
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  }, [resync, queryClient]);

  const { data: reviews, isPending } = useQuery({
    queryKey: ["reviews"],
    queryFn: api.reviews.list,
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    }
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats.get
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
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.header)}>
        <div>
          <h1 {...stylex.props(shared.pageTitle)}>Dashboard</h1>
          <p {...stylex.props(shared.lede)}>What fouine is doing, latest first.</p>
        </div>
        {inFlight.length > 0 && (
          <span {...stylex.props(shared.row, s.runningPill)}>
            <span {...stylex.props(shared.dot, s.runningDot)} />
            {inFlight.length} running
          </span>
        )}
        <LiveBadge status={status} />
      </div>

      {/* The two KPI strips are short — stack them on the left and let the 30-day
          cost chart stretch to their combined height beside them (default grid
          `stretch`, and CostTrend grows its bar area to fill). */}
      <div {...stylex.props(s.grid2)}>
        <div {...stylex.props(s.column)}>
          <div {...stylex.props(s.strip)}>
            <Stat
        style={s.cell}
              label="In flight"
              value={isPending ? null : String(inFlight.length)}
              accent={inFlight.length > 0}
              pulse={inFlight.length > 0}
            />
            <Stat
        style={s.cell}
              label="Success · 24h"
              value={isPending ? null : successRate == null ? "—" : `${successRate}%`}
              sub={failed24.length ? `${failed24.length} failed` : finished24 ? "all clean" : undefined}
            />
            <Stat style={s.cell} label="Cost · 24h" value={isPending ? null : formatCost(cost24) ?? "—"} />
            <Stat style={s.cell} label="Reviews · 24h" value={isPending ? null : String(last24h.length)} />
          </div>
          {stats && <AggregateStats stats={stats} />}
        </div>
        {stats && stats.daily.length > 0 && <CostTrend daily={last30Days(stats.daily)} />}
      </div>

      {/* Anything in flight takes the left column with the distribution bars
          stacked on the right; when nothing's running the bars sit side by side. */}
      {(inFlight.length > 0 || hasMix) && (
        <div {...stylex.props(s.grid2, s.gridTop)}>
          {inFlight.length > 0 && (
            <section {...stylex.props(s.running, !hasMix && s.runningWide)}>
              <h2 {...stylex.props(s.runningTitle)}>Running now</h2>
              <ul {...stylex.props(s.list)}>
                {inFlight.map((r) => (
                  <ActivityRow key={r.id} r={r} ember />
                ))}
              </ul>
            </section>
          )}
          {hasMix &&
            (inFlight.length > 0 ? (
              <div {...stylex.props(s.column)}>
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
        <div {...stylex.props(s.grid2, s.gridTop)}>
          {/* The 5-col project table is wide by nature — span both columns; the
              model table + expensive list pair up beside each other. */}
          {stats.projects.length > 0 && (
            <div {...stylex.props(s.wide)}>
              <ProjectStats projects={stats.projects} />
            </div>
          )}
          {stats.models.length > 0 && <ModelStats models={stats.models} />}
          {stats.topCost.length > 0 && <TopCost rows={stats.topCost} />}
        </div>
      )}

      <section {...stylex.props(s.section)}>
        <h2 {...stylex.props(s.sectionTitle)}>Recent activity</h2>
        <div {...stylex.props(s.card)}>
          {isPending ? (
            <SkeletonRows />
          ) : recent.length === 0 ? (
            <Empty />
          ) : (
            <ul {...stylex.props(s.list)}>
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
    <div {...stylex.props(s.strip)}>
      <Stat style={s.cell} label="Avg review" value={formatSeconds(stats.latency.avg) ?? "—"} />
      <Stat
        style={s.cell}
        label="p95 review"
        value={formatSeconds(stats.latency.p95) ?? "—"}
        sub={stats.latency.count ? `${stats.latency.count} done` : undefined}
      />
      <Stat style={s.cell} label="Avg cost / review" value={formatCost(avgCost) ?? "—"} />
      <Stat
        style={s.cell}
        label="Retry rate"
        value={retryRate == null ? "—" : `${retryRate}%`}
        sub={retries ? `${retries} retried` : undefined}
      />
    </div>
  );
}

// /api/stats is unfiltered by default (no param = no filter), so `daily` now
// spans all of history. This chart is the one part of the dashboard that wants a
// window — it says "last 30d" on the tin — so it clips its own, rather than the
// endpoint imposing a window every other caller would silently inherit.
// Clips on whole days, where the old SQL cut at an instant 30*86400s ago, so the
// leftmost bar is now a full day instead of a partial one. Every other bar is
// unchanged — and a full-day bar is the more honest one to draw.
function last30Days(daily: DailyStatsRow[]): DailyStatsRow[] {
  const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  return daily.filter((d) => d.day >= cutoff);
}

const trend = stylex.create({
  body: {
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    flexDirection: "column",
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`,
    paddingInline: space.x16,
    paddingTop: space.x16,
    paddingBottom: space.x12
  },
  bars: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.x4,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: space.x96
  },
  bar: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    borderStartStartRadius: radius.base,
    borderStartEndRadius: radius.base,
    backgroundColor: {
      default: `color-mix(in oklab, ${color.ember500} 70%, transparent)`,
      ":hover": color.ember400
    },
    transitionProperty: "color, background-color",
    transitionDuration: "150ms"
  },
  // Runtime-computed: the day's cost as a share of the window's max.
  barHeight: (h: string) => ({ height: h }),
  axis: {
    marginTop: space.x8,
    display: "flex",
    justifyContent: "space-between",
    fontSize: text.xxs,
    color: color.zinc600,
    fontVariantNumeric: "tabular-nums"
  }
});

function CostTrend({ daily }: { daily: DailyStatsRow[] }) {
  const max = Math.max(...daily.map((d) => d.cost), 0.0001);
  return (
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>Cost · last 30d</h2>
      <div {...stylex.props(trend.body)}>
        <div {...stylex.props(trend.bars)}>
          {daily.map((d) => (
            <div
              key={d.day}
              title={`${d.day} · ${formatCost(d.cost)} · ${d.reviews} review${d.reviews === 1 ? "" : "s"}`}
              {...stylex.props(trend.bar, trend.barHeight(`${Math.max(2, (d.cost / max) * 100)}%`))}
            />
          ))}
        </div>
        {daily.length > 0 && (
          <div {...stylex.props(trend.axis)}>
            <span>{daily[0].day}</span>
            <span>{daily[daily.length - 1].day}</span>
          </div>
        )}
      </div>
    </section>
  );
}

const cells = stylex.create({
  num: {
    paddingBlock: space.x10,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: color.zinc400
  },
  numStrong: {
    paddingBlock: space.x10,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: color.zinc200
  },
  numTotal: {
    paddingBlock: space.x10,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: color.zinc300
  },
  numTotalCost: {
    paddingBlock: space.x10,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: color.zinc100,
    fontWeight: 600
  },
  mono: {
    paddingBlock: space.x10,
    fontFamily: font.mono,
    color: color.zinc200
  },
  totalLabel: {
    paddingBlock: space.x10,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: tracking.wide,
    color: color.zinc500
  },
  headRight: { textAlign: "right" },
  repoLink: { color: { default: null, ":hover": color.ember300 } },
  foot: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: color.zinc800
  },
  footRow: { backgroundColor: { default: null, ":hover": "transparent" } }
});

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
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>Cost by project</h2>
      <div {...stylex.props(s.card)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead style={cells.headRight}>Reviews</TableHead>
              <TableHead style={cells.headRight}>Avg time</TableHead>
              <TableHead style={cells.headRight}>Tokens</TableHead>
              <TableHead style={cells.headRight}>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => {
              const [owner, name] = p.repo_full_name.split("/");
              return (
                <TableRow key={p.repo_full_name}>
                  <TableCell style={cells.mono}>
                    {owner && name ? (
                      <Link
                        to="/repos/$owner/$name"
                        params={{ owner, name }}
                        {...stylex.props(cells.repoLink)}
                      >
                        {p.repo_full_name}
                      </Link>
                    ) : (
                      p.repo_full_name
                    )}
                  </TableCell>
                  <TableCell style={cells.num}>{p.reviews}</TableCell>
                  <TableCell style={cells.num}>{formatSeconds(p.avg_duration) ?? "—"}</TableCell>
                  <TableCell style={cells.num}>{formatTokens(p.tokens) ?? "—"}</TableCell>
                  <TableCell style={cells.numStrong}>{formatCost(p.cost) ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {projects.length > 1 && (
            <tfoot {...stylex.props(cells.foot)}>
              <TableRow style={cells.footRow}>
                <TableCell style={cells.totalLabel}>Total</TableCell>
                <TableCell style={cells.numTotal}>{totals.reviews}</TableCell>
                <TableCell />
                <TableCell style={cells.numTotal}>{formatTokens(totals.tokens) ?? "—"}</TableCell>
                <TableCell style={cells.numTotalCost}>{formatCost(totals.cost) ?? "—"}</TableCell>
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
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>Cost by model</h2>
      <div {...stylex.props(s.card)}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead style={cells.headRight}>Reviews</TableHead>
              <TableHead style={cells.headRight}>Tokens</TableHead>
              <TableHead style={cells.headRight}>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.model}>
                <TableCell style={cells.mono}>{m.model}</TableCell>
                <TableCell style={cells.num}>{m.reviews}</TableCell>
                <TableCell style={cells.num}>{formatTokens(m.tokens) ?? "—"}</TableCell>
                <TableCell style={cells.numStrong}>{formatCost(m.cost) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

const row = stylex.create({
  // divide-y: the hairline goes on each <li> but the first, which is where the
  // `& > * + *` rule used to land.
  divider: {
    borderTopWidth: { default: "1px", ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: `color-mix(in oklab, ${color.zinc800} 70%, transparent)`
  },
  dividerEmber: {
    borderTopColor: `color-mix(in oklab, ${color.ember800} 25%, transparent)`
  },
  link: {
    display: "flex",
    alignItems: "center",
    gap: space.x12,
    paddingInline: space.x16,
    paddingBlock: space.x10,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc800} 40%, transparent)`
    }
  },
  title: {
    fontFamily: font.mono,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc200
  },
  sub: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500
  },
  trigger: {
    display: { default: "none", "@media (min-width: 640px)": "inline" },
    flexShrink: 0,
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`,
    paddingInline: space.x6,
    paddingBlock: space.x2,
    fontSize: text.xxs,
    color: color.zinc400
  },
  metaSm: {
    flexShrink: 0,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    fontVariantNumeric: "tabular-nums",
    width: space.x56,
    textAlign: "right"
  },
  metaLg: {
    flexShrink: 0,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    fontVariantNumeric: "tabular-nums",
    width: space.x64,
    textAlign: "right"
  },
  costLg: {
    flexShrink: 0,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc100,
    fontVariantNumeric: "tabular-nums",
    width: space.x64,
    textAlign: "right"
  }
});

function TopCost({ rows }: { rows: Stats["topCost"] }) {
  return (
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>Most expensive reviews</h2>
      <div {...stylex.props(s.card)}>
        <ul {...stylex.props(s.list)}>
          {rows.map((r) => (
            <li key={r.id} {...stylex.props(row.divider)}>
              <Link to="/reviews/$id" params={{ id: String(r.id) }} {...stylex.props(row.link)}>
                <div {...stylex.props(shared.fill)}>
                  <div {...stylex.props(shared.truncate, row.title)}>
                    {r.repo_full_name}
                    {r.pr_number > 0 ? `#${r.pr_number}` : ""}
                  </div>
                  {r.model && <div {...stylex.props(shared.truncate, row.sub)}>{r.model}</div>}
                </div>
                {r.tokens != null && (
                  <span {...stylex.props(row.metaSm)}>{formatTokens(r.tokens)}</span>
                )}
                <span {...stylex.props(row.costLg)}>{formatCost(r.cost)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// Hue order here is deliberately NOT charts/colors.ts's TRIGGER_COLORS: violet
// and amber are swapped relative to the shared ramp. Kept as-is so the chart
// looks exactly as it did — the two palettes are being reconciled separately.
const hues = stylex.create({
  ember: { backgroundColor: color.cat1 },
  sky: { backgroundColor: color.cat2 },
  violet: { backgroundColor: color.cat4 },
  amber: { backgroundColor: color.cat3 },
  zinc: { backgroundColor: color.cat5 }
});

const TRIGGER_COLORS = [hues.ember, hues.sky, hues.violet, hues.amber, hues.zinc];

const mix = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.x12,
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`,
    paddingInline: space.x16,
    paddingBlock: space.x14
  },
  track: {
    display: "flex",
    height: space.x8,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: color.zinc800
  },
  // Runtime-computed: each slice's share of the total.
  slice: (pct: string) => ({ width: pct }),
  legend: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.x16,
    rowGap: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc400
  },
  count: { color: color.zinc600 }
});

function TriggerMix({ triggers }: { triggers: TriggerStatsRow[] }) {
  const total = triggers.reduce((s, t) => s + t.count, 0);
  if (!total) return null;
  return (
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>How reviews start</h2>
      <div {...stylex.props(mix.body)}>
        <div {...stylex.props(mix.track)}>
          {triggers.map((t, i) => (
            <div
              key={t.trigger}
              title={`${triggerLabel(t.trigger) ?? t.trigger}: ${t.count}`}
              {...stylex.props(
                mix.slice(`${(t.count / total) * 100}%`),
                TRIGGER_COLORS[i % TRIGGER_COLORS.length],
              )}
            />
          ))}
        </div>
        <div {...stylex.props(mix.legend)}>
          {triggers.map((t, i) => (
            <span key={t.trigger} {...stylex.props(shared.rowTight, shared.tabular)}>
              <span {...stylex.props(shared.dotLarge, TRIGGER_COLORS[i % TRIGGER_COLORS.length])} />
              {triggerLabel(t.trigger) ?? t.trigger}
              <span {...stylex.props(mix.count)}>{t.count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// blocking = alarm, question = ask, nit = muted — same palette as the review view.
const sev = stylex.create({
  blocking: { backgroundColor: color.dangerDot },
  question: { backgroundColor: color.warnDot },
  nit: { backgroundColor: color.cat5 }
});

const SEVERITY_META: Record<string, { label: string; dot: stylex.StyleXStyles }> = {
  blocking: { label: "blocking", dot: sev.blocking },
  question: { label: "question", dot: sev.question },
  nit: { label: "nit", dot: sev.nit }
};

function SeverityMix({ severity }: { severity: SeverityStatsRow[] }) {
  const total = severity.reduce((s, x) => s + x.count, 0);
  if (!total) return null;
  return (
    <section {...stylex.props(s.section)}>
      <h2 {...stylex.props(s.sectionTitle)}>Findings by severity</h2>
      <div {...stylex.props(mix.body)}>
        <div {...stylex.props(mix.track)}>
          {severity.map((x) => (
            <div
              key={x.severity}
              title={`${SEVERITY_META[x.severity]?.label ?? x.severity}: ${x.count}`}
              {...stylex.props(
                mix.slice(`${(x.count / total) * 100}%`),
                SEVERITY_META[x.severity]?.dot ?? sev.nit,
              )}
            />
          ))}
        </div>
        <div {...stylex.props(mix.legend)}>
          {severity.map((x) => (
            <span key={x.severity} {...stylex.props(shared.rowTight, shared.tabular)}>
              <span {...stylex.props(shared.dotLarge, SEVERITY_META[x.severity]?.dot ?? sev.nit)} />
              {SEVERITY_META[x.severity]?.label ?? x.severity}
              <span {...stylex.props(mix.count)}>{x.count}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ r, ember }: { r: ReviewRow; ember?: boolean }) {
  const trigger = triggerLabel(r.trigger);
  const cost = formatCost(r.cost);
  return (
    <li {...stylex.props(row.divider, ember && row.dividerEmber)}>
      <Link to="/reviews/$id" params={{ id: String(r.id) }} {...stylex.props(row.link)}>
        <Badge status={r.status} />
        <div {...stylex.props(shared.fill)}>
          <div {...stylex.props(shared.truncate, row.title)}>
            {r.repo_full_name}
            {r.pr_number > 0 ? `#${r.pr_number}` : ""}
          </div>
          {r.title && <div {...stylex.props(shared.truncate, row.sub)}>{r.title}</div>}
        </div>
        {trigger && <span {...stylex.props(row.trigger)}>{trigger}</span>}
        {cost && <span {...stylex.props(row.metaSm)}>{cost}</span>}
        <span
          title={new Date(r.created_at * 1000).toLocaleString()}
          {...stylex.props(row.metaLg)}
        >
          {timeAgo(r.created_at)}
        </span>
      </Link>
    </li>
  );
}

const skel = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.x12,
    paddingInline: space.x16,
    paddingBlock: space.x10
  },
  bar: {
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 70%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  badge: { height: space.x20, width: space.x64, borderRadius: radius.full },
  title: {
    height: space.x16,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    maxWidth: space.x256,
    borderRadius: radius.base
  },
  meta: { height: space.x16, width: space.x48, borderRadius: radius.base }
});

function SkeletonRows() {
  return (
    <ul {...stylex.props(s.list)}>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} {...stylex.props(row.divider, skel.row)}>
          <div {...stylex.props(skel.bar, skel.badge)} />
          <div {...stylex.props(skel.bar, skel.title)} />
          <div {...stylex.props(skel.bar, skel.meta)} />
        </li>
      ))}
    </ul>
  );
}

const empty = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.x8,
    paddingInline: space.x16,
    paddingBlock: space.x48,
    textAlign: "center"
  },
  icon: { color: color.zinc700 },
  hint: {
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc600,
    maxWidth: space.x320
  },
  code: {
    fontFamily: font.mono,
    color: color.zinc500
  }
});

function Empty() {
  return (
    <div {...stylex.props(empty.root)}>
      <Inbox size={20} {...stylex.props(empty.icon)} />
      <p {...stylex.props(shared.meta)}>No reviews yet.</p>
      <p {...stylex.props(empty.hint)}>
        Enable a repo, then open a PR or comment <span {...stylex.props(empty.code)}>/fouine</span> to
        kick off the first one.
      </p>
    </div>
  );
}
