import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import {
  api,
  type DailyStatsRow,
  type FindingsDailyRow,
  type LatencyDayRow,
  type ReliabilityRow,
  type TopFileRow,
  type ModelStatsRow,
  type ProjectStatsRow,
  type ReviewRow,
  type SeverityStatsRow,
  type Stats,
  type StatsRange,
  type TriggerStatsRow
} from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatSeconds, formatTokens, timeAgo, triggerLabel } from "@/lib/format";
import { Calendar as CalendarIcon, ListFilter, SlidersHorizontal, X } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BAR_ROUNDED_BOTTOM,
  BarChart,
  LegendDot,
  MixBar,
  Panel,
  PanelEmpty,
  PanelSkeleton,
  SEVERITY_COLORS,
  StackedBarChart,
  TRIGGER_COLORS,
  UNKNOWN_SEVERITY_COLOR,
  scaleMax
} from "@/components/charts";
import { color, font, leading, radius, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";

const RANGES = ["24h", "7d", "30d", "90d", "all"] as const;
const DEFAULT_RANGE: StatsRange = "30d";
const STATUSES = ["pending", "running", "completed", "failed"] as const;
type Status = (typeof STATUSES)[number];

// `transition-colors`, spelled out once. StyleX has no utility layer to inherit
// from, so the property list and the 150ms default travel together.
const TRANSITION_COLORS = "color, background-color, border-color";

const s = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    // Was `space-y-7`: a margin between siblings, which a column gap expresses
    // without touching the children.
    gap: space.x28,
    minWidth: 0
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.x16
  },

  // --- filter bar ---------------------------------------------------------
  filterBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.x12,
    rowGap: space.x8,
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`,
    paddingInline: space.x12,
    paddingBlock: space.x10
  },
  filterIcon: { color: color.zinc500, flexShrink: 0 },
  rangeGroup: {
    display: "flex",
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800
  },
  rangeButton: {
    paddingInline: space.x10,
    paddingBlock: space.x4,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    borderWidth: 0,
    cursor: "pointer",
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms"
  },
  rangeButtonOn: {
    backgroundColor: `color-mix(in oklab, ${color.ember950} 60%, transparent)`,
    color: color.ember300
  },
  rangeButtonOff: {
    color: { default: color.zinc400, ":hover": color.zinc100 },
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in oklab, ${color.zinc800} 60%, transparent)`
    }
  },
  clearButton: {
    display: "flex",
    alignItems: "center",
    gap: space.x4,
    borderRadius: radius.md,
    borderWidth: 0,
    paddingInline: space.x8,
    paddingBlock: space.x4,
    fontSize: text.xs,
    lineHeight: leading.xs,
    cursor: "pointer",
    color: { default: color.zinc400, ":hover": color.zinc100 },
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in oklab, ${color.zinc800} 60%, transparent)`
    },
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms"
  },
  rangePickerButton: {
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingInline: space.x8,
    paddingBlock: space.x4,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms"
  },
  rangePickerOn: {
    // No border colour on purpose: `border-ember-900` never generated a rule —
    // --color-ember-900 is not in global.css's @theme block (the ramp is
    // 200/300/400/500/600/800/950) — so this button has no border today.
    backgroundColor: `color-mix(in oklab, ${color.ember950} 60%, transparent)`,
    color: color.ember300
  },
  rangePickerOff: {
    borderColor: { default: color.zinc800, ":hover": color.zinc700 },
    backgroundColor: color.zinc900,
    color: { default: color.zinc400, ":hover": color.zinc100 }
  },
  popoverContent: {
    // `w-auto p-0` — the calendar sizes itself.
    width: "auto",
    padding: space.x0
  },
  select: {
    maxWidth: space.x208,
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: color.zinc800, ":hover": color.zinc700 },
    backgroundColor: color.zinc900,
    paddingInline: space.x8,
    paddingBlock: space.x4,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc300,
    cursor: "pointer",
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms",
    outlineStyle: { default: null, ":focus": "none" },
    // `focus:ring-1 focus:ring-ember-500` — ring is a non-inset box-shadow.
    boxShadow: { default: null, ":focus": `0 0 0 1px ${color.ember500}` }
  },
  filterButton: {
    borderRadius: radius.base,
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: space.x4,
    cursor: "pointer",
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms"
  },
  filterButtonOn: { color: color.ember300 },
  filterButtonOff: {
    color: { default: color.zinc600, ":hover": color.zinc200 },
    backgroundColor: { default: "transparent", ":hover": color.zinc800 }
  },

  // --- KPI strip ---------------------------------------------------------
  statStrip: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (min-width: 640px)": "repeat(3, minmax(0, 1fr))",
      "@media (min-width: 1024px)": "repeat(6, minmax(0, 1fr))"
    },
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    overflow: "hidden",
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`
  },
  // Was `divide-x divide-y lg:divide-y-0` on the strip — `& > :not(:last-child)`
  // rules, which StyleX cannot reach from the parent. The border lives on the
  // cell instead, same move as the table rows.
  statCell: {
    borderInlineEndWidth: { default: "1px", ":last-child": 0 },
    borderBottomWidth: {
      default: "1px",
      ":last-child": 0,
      // lg:divide-y-0 — one row at that width, so no horizontal rule.
      "@media (min-width: 1024px)": 0
    },
    borderInlineEndStyle: "solid",
    borderInlineEndColor: color.zinc800,
    borderBottomStyle: "solid",
    borderBottomColor: color.zinc800
  },

  // --- page grids --------------------------------------------------------
  // `items-start` everywhere: the charts size themselves off a fixed height,
  // and a stretched row would leave the percentage bars resolving against it.
  grid: {
    display: "grid",
    gap: space.x28,
    alignItems: "start"
  },
  cols2: {
    gridTemplateColumns: {
      default: null,
      "@media (min-width: 1024px)": "repeat(2, minmax(0, 1fr))"
    }
  },
  cols3: {
    gridTemplateColumns: {
      default: null,
      "@media (min-width: 1024px)": "repeat(3, minmax(0, 1fr))"
    }
  },
  cols5: {
    gridTemplateColumns: {
      default: null,
      "@media (min-width: 1024px)": "repeat(5, minmax(0, 1fr))"
    }
  },
  span2: {
    gridColumn: { default: null, "@media (min-width: 1024px)": "span 2 / span 2" },
    minWidth: 0
  },
  span3: {
    gridColumn: { default: null, "@media (min-width: 1024px)": "span 3 / span 3" },
    minWidth: 0
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: space.x28,
    minWidth: 0
  },

  // --- panel innards -----------------------------------------------------
  chartBody: {
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    flexDirection: "column",
    paddingInline: space.x16,
    paddingTop: space.x16,
    paddingBottom: space.x12
  },
  caption: {
    marginTop: space.x8,
    display: "flex",
    justifyContent: "space-between",
    fontSize: text.xxs,
    color: color.zinc600,
    fontVariantNumeric: "tabular-nums"
  },
  legendRow: {
    marginTop: space.x8,
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.x12,
    rowGap: space.x4,
    fontSize: text.xxs,
    color: color.zinc500
  },
  legendRowCentred: { alignItems: "center" },
  pushRight: { marginInlineStart: "auto", fontVariantNumeric: "tabular-nums" },
  scrollX: { overflowX: "auto" },

  // --- table cells -------------------------------------------------------
  rowActive: {
    backgroundColor: `color-mix(in oklab, ${color.ember950} 25%, transparent)`
  },
  cellTight: { paddingBlock: space.x10 },
  right: { textAlign: "right" },
  nowrap: { whiteSpace: "nowrap" },
  headNarrow: { width: space.x48 },
  mono: { fontFamily: font.mono },
  monoLink: {
    fontFamily: font.mono,
    color: { default: color.zinc200, ":hover": color.ember300 }
  },
  modelButton: {
    fontFamily: font.mono,
    textAlign: "left",
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: space.x0,
    cursor: "pointer",
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms"
  },
  modelButtonOn: { color: color.ember300 },
  modelButtonOff: { color: { default: color.zinc200, ":hover": color.ember300 } },
  z200: { color: color.zinc200 },
  z400: { color: color.zinc400 },
  z500: { color: color.zinc500 },
  z600: { color: color.zinc600 },

  // --- lists -------------------------------------------------------------
  // `divide-y` moved onto the item, the only place StyleX can express it.
  listItem: {
    borderBottomWidth: { default: "1px", ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in oklab, ${color.zinc800} 70%, transparent)`
  },
  listItemFaint: {
    borderBottomWidth: { default: "1px", ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`
  },
  costLink: {
    display: "flex",
    alignItems: "center",
    gap: space.x12,
    paddingInline: space.x16,
    paddingBlock: space.x10,
    transitionProperty: TRANSITION_COLORS,
    transitionDuration: "150ms",
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc800} 40%, transparent)`
    }
  },
  costRepo: {
    fontFamily: font.mono,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc200
  },
  xs: { fontSize: text.xs, lineHeight: leading.xs },
  costTokens: {
    flexShrink: 0,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500,
    fontVariantNumeric: "tabular-nums",
    width: space.x56,
    textAlign: "right"
  },
  costValue: {
    flexShrink: 0,
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc100,
    fontVariantNumeric: "tabular-nums",
    width: space.x64,
    textAlign: "right"
  },

  // --- reliability -------------------------------------------------------
  rateRow: { display: "flex", alignItems: "baseline", gap: space.x8 },
  rate: {
    fontSize: text.xl2,
    lineHeight: leading.xl2,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: color.zinc100
  },
  rateSub: { fontSize: text.xs, lineHeight: leading.xs, color: color.zinc500 },
  chartGap: { marginTop: space.x12 },

  // --- latency trend -----------------------------------------------------
  latencyRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.x4,
    // Fixed height, not a min-height: the two bars below are percentage-tall
    // and a percentage only resolves against a definite parent height.
    height: space.x128
  },
  latencyColumn: {
    position: "relative",
    height: "100%"
  },
  latencyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderStartStartRadius: radius.base,
    borderStartEndRadius: radius.base
  },
  latencyP95: { backgroundColor: `color-mix(in oklab, ${color.ember500} 25%, transparent)` },
  latencyP50: { backgroundColor: `color-mix(in oklab, ${color.ember500} 80%, transparent)` },
  truncatedNote: {
    marginTop: space.x4,
    fontSize: text.xxs,
    color: `color-mix(in oklab, ${color.warnStrong} 80%, transparent)`
  },
  // Runtime-computed: each bar's share of the tallest value in the window.
  barHeight: (pct: string) => ({ height: pct }),

  // --- top files ---------------------------------------------------------
  fileItem: { position: "relative", paddingInline: space.x16, paddingBlock: space.x8 },
  fileBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: `color-mix(in oklab, ${color.ember500} 10%, transparent)`
  },
  // Runtime-computed: the row's share of the busiest file.
  barWidth: (pct: string) => ({ width: pct }),
  fileRow: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.x12
  },
  filePath: {
    fontFamily: font.mono,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc300
  },
  fileCount: {
    flexShrink: 0,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontVariantNumeric: "tabular-nums",
    color: color.zinc400
  }
});

// Reliability's three outcomes. Not in charts/colors.ts because they are an
// outcome triple, not a categorical ramp — completed/failed/in-flight always
// mean the same thing and must match the legend beneath the bars.
const outcome = stylex.create({
  completed: { backgroundColor: `color-mix(in oklab, ${color.okDot} 80%, transparent)` },
  failed: { backgroundColor: color.dangerDot },
  inFlight: { backgroundColor: color.zinc600 }
});

// The latency trend's own legend swatches — the same two ember mixes as the bars.
const latency = stylex.create({
  p50: { backgroundColor: `color-mix(in oklab, ${color.ember500} 80%, transparent)` },
  p95: { backgroundColor: `color-mix(in oklab, ${color.ember500} 25%, transparent)` }
});

export interface StatsSearch {
  // `range` is absent from the URL when it's the default — a clean link for the
  // default view. Everything reads it through `search.range ?? DEFAULT_RANGE`.
  range?: StatsRange;
  // Custom window, YYYY-MM-DD. Either bound alone is valid. When either is set
  // it wins and `range` is ignored, so the UI can never show a custom window
  // while a preset still looks selected.
  from?: string;
  to?: string;
  repo?: string;
  model?: string;
  status?: Status;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

// Same shape of validation as the server's dayEpoch: a real UTC calendar day or
// nothing. Keeps `from=lol` out of the URL instead of round-tripping garbage.
// The NaN check is load-bearing: "2026-13-45" passes the regex, and calling
// toISOString() on the resulting Invalid Date throws a RangeError that takes
// the whole page down rather than falling back to the preset.
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
};

const day = (v: unknown) => (isDay(v) ? v : undefined);

export function validateStatsSearch(raw: Record<string, unknown>): StatsSearch {
  const range = RANGES.find((r) => r === raw.range && r !== DEFAULT_RANGE);
  const status = STATUSES.find((s) => s === raw.status);
  const from = day(raw.from);
  const to = day(raw.to);
  return {
    // A custom window owns the time axis; drop range so the two can't disagree.
    range: from || to ? undefined : range,
    from,
    to,
    repo: str(raw.repo),
    model: str(raw.model),
    status
  };
}

export default function StatsPage() {
  const search = useSearch({ strict: false }) as StatsSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // A custom window replaces the preset entirely — `custom` drives both the
  // request and whether any preset button renders as selected.
  const custom = Boolean(search.from || search.to);
  const range = search.range ?? DEFAULT_RANGE;
  const filters = custom
    ? { from: search.from, to: search.to, repo: search.repo, model: search.model }
    : { range, repo: search.repo, model: search.model };
  const reviewFilters = { ...filters, status: search.status };

  const setFilters = (patch: StatsSearch) =>
    navigate({
      to: "/stats",
      search: (prev: Record<string, unknown>) => validateStatsSearch({ ...prev, ...patch })
    });

  const { status: liveStatus, resync } = useLiveEvents(null, (e) => {
    if (e.type.startsWith("review:")) {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["stats-charts"] });
    }
  });
  useEffect(() => {
    if (resync > 0) {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["stats-charts"] });
    }
  }, [resync, queryClient]);

  const { data: stats } = useQuery({
    queryKey: ["stats", filters],
    queryFn: () => api.stats.query(filters)
  });
  const { data: charts } = useQuery({
    queryKey: ["stats-charts", filters],
    queryFn: () => api.stats.charts(filters)
  });
  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: api.repos.list });
  const { data: reviews, isPending: reviewsPending } = useQuery({
    queryKey: ["reviews", reviewFilters],
    queryFn: () => api.reviews.query(reviewFilters)
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
  const filtered = Boolean(
    search.repo || search.model || search.status || search.range || custom,
  );

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.header)}>
        <div>
          <h1 {...stylex.props(shared.pageTitle)}>Stats</h1>
          <p {...stylex.props(shared.lede)}>
            Slice fouine's activity by time, repository and model.
          </p>
        </div>
        <LiveBadge status={liveStatus} />
      </div>

      {/* One compact filter bar; every control writes to the URL. */}
      <div {...stylex.props(s.filterBar)}>
        <SlidersHorizontal size={14} {...stylex.props(s.filterIcon)} />
        <div role="group" aria-label="Time range" {...stylex.props(s.rangeGroup)}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              // Deselected while a custom window is active: the presets must
              // never claim "30d" over a view that isn't 30 days.
              aria-pressed={!custom && r === range}
              onClick={() =>
                setFilters({
                  range: r === DEFAULT_RANGE ? undefined : r,
                  from: undefined,
                  to: undefined
                })
              }
              {...stylex.props(
                s.rangeButton,
                !custom && r === range ? s.rangeButtonOn : s.rangeButtonOff,
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {/* The presets stay; this sits beside them for an arbitrary window.
            Selecting a range writes from/to, which wins over range server-side
            and deselects every preset. */}
        <RangePicker
          from={search.from}
          to={search.to}
          onChange={({ from, to }) => setFilters({ from, to })}
        />
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
            {...stylex.props(s.clearButton)}
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      <div {...stylex.props(s.statStrip)}>
        <Stat
          style={s.statCell}
          label="Reviews"
          value={totals ? String(totals.reviews) : null}
        />
        <Stat
          style={s.statCell}
          label="Avg review"
          value={stats ? (formatSeconds(stats.latency.avg) ?? "—") : null}
          sub={stats?.latency.count ? `${stats.latency.count} done` : undefined}
        />
        <Stat
          style={s.statCell}
          label="p95 review"
          value={stats ? (formatSeconds(stats.latency.p95) ?? "—") : null}
        />
        <Stat
          style={s.statCell}
          label="Cost"
          value={totals ? (formatCost(totals.cost) ?? "—") : null}
        />
        <Stat
          style={s.statCell}
          label="Avg cost / review"
          value={stats ? (formatCost(avgCost) ?? "—") : null}
        />
        <Stat
          style={s.statCell}
          label="Tokens"
          value={totals ? (formatTokens(totals.tokens) ?? "—") : null}
        />
      </div>

      {/* Desktop: the trend gets two thirds of the width, the two mix bars stack
          beside it. Everything collapses to one column below `lg`. */}
      <div {...stylex.props(s.grid, s.cols3)}>
        <div {...stylex.props(s.span2)}>
          <CostTrend
            daily={stats?.daily}
            range={range}
            windowLabel={
              custom
                ? search.from && search.to
                  ? `${search.from} → ${search.to}`
                  : search.from
                    ? `since ${search.from}`
                    : `until ${search.to}`
                : undefined
            }
          />
        </div>
        <div {...stylex.props(s.stack)}>
          <SeverityMix severity={stats?.severity} />
          <TriggerMix triggers={stats?.triggers} />
        </div>
      </div>

      {/* Reliability first: "is the reviewer working" outranks what it costs.
          Paired with the latency trend, which answers "and is it getting
          slower" from the same completed reviews. */}
      <div {...stylex.props(s.grid, s.cols2)}>
        <Reliability rows={charts?.reliability} />
        <LatencyTrend rows={charts?.latency} truncated={charts?.latencyTruncated} />
      </div>

      <div {...stylex.props(s.grid, s.cols5)}>
        <div {...stylex.props(s.span3)}>
          <FindingsTrend rows={charts?.findingsDaily} />
        </div>
        <div {...stylex.props(s.span2)}>
          <TopFiles rows={charts?.topFiles} />
        </div>
      </div>

      {/* Two wide tables with long identifiers in the first column. 3/5 + 2/5
          rather than 2/3 + 1/3, which clipped the model table's cost column, or
          a straight half each, which then clipped the wider project table. */}
      <div {...stylex.props(s.grid, s.cols5)}>
        <div {...stylex.props(s.span3)}>
          <ProjectStats
            projects={stats?.projects}
            active={search.repo}
            onFilter={(repo) => setFilters({ repo })}
          />
        </div>
        <div {...stylex.props(s.span2)}>
          <ModelStats
            models={stats?.models}
            active={search.model}
            onFilter={(model) => setFilters({ model })}
          />
        </div>
      </div>

      <div {...stylex.props(s.grid, s.cols3)}>
        <div {...stylex.props(s.span2)}>
          <Reviews rows={reviews} pending={reviewsPending} />
        </div>
        <TopCost rows={stats?.topCost} />
      </div>
    </div>
  );
}

// The URL carries plain calendar days and the server reads them as UTC, but
// react-day-picker hands back a Date at LOCAL midnight. Convert through the
// local Y/M/D parts, never toISOString(): in Europe/Paris a local midnight is
// the previous day in UTC, so toISOString() would shift every picked date back
// by one. Going through the parts keeps the day the user clicked, the day in
// the URL and the day the SQL buckets all the same day.
function toDayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromDayString(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function RangePicker({
  from,
  to,
  onChange
}: {
  from?: string;
  to?: string;
  onChange: (r: { from?: string; to?: string }) => void;
}) {
  const selected: DateRange | undefined = from || to ? { from: fromDayString(from), to: fromDayString(to) } : undefined;
  const label =
    from && to ? `${from} → ${to}` : from ? `since ${from}` : to ? `until ${to}` : "Custom range";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Custom date range"
          {...stylex.props(
            shared.rowTight,
            s.rangePickerButton,
            from || to ? s.rangePickerOn : s.rangePickerOff,
          )}
        >
          <CalendarIcon size={13} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent style={s.popoverContent} align="start">
        <Calendar
          mode="range"
          defaultMonth={fromDayString(from) ?? fromDayString(to)}
          selected={selected}
          onSelect={(r: DateRange | undefined) =>
            onChange({
              from: r?.from ? toDayString(r.from) : undefined,
              to: r?.to ? toDayString(r.to) : undefined
            })
          }
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder
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
      {...stylex.props(s.select)}
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

// Small affordance next to a row that already links somewhere — clicking it
// applies the row as a filter instead of navigating away.
function FilterButton({
  label,
  active,
  onClick
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
      {...stylex.props(s.filterButton, active ? s.filterButtonOn : s.filterButtonOff)}
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
  all: "all time"
};

function CostTrend({
  daily,
  range,
  windowLabel
}: {
  daily?: DailyStatsRow[];
  range: StatsRange;
  windowLabel?: string;
}) {
  const max = scaleMax((daily ?? []).map((d) => d.cost));
  return (
    <Panel title={`Cost · ${windowLabel ?? RANGE_LABELS[range]}`}>
      {!daily ? (
        <PanelSkeleton rows={6} />
      ) : daily.length === 0 ? (
        <PanelEmpty label="No spend in this window." />
      ) : (
        <div {...stylex.props(s.chartBody)}>
          {/* BarChart carries its own 10rem height, not flex-1 + min-height: the
              bars are sized with percentage heights, and a percentage only
              resolves against a definite parent height. This row sits in an
              items-start grid, so the panel is not stretched and a min-height
              alone left every bar at 0px. */}
          <BarChart
            bars={daily.map((d) => ({
              key: d.day,
              value: d.cost,
              title: `${d.day} · ${formatCost(d.cost)} · ${d.reviews} review${d.reviews === 1 ? "" : "s"}`
            }))}
          />
          {/* No axes: this caption row carries the endpoints and the peak. */}
          <div {...stylex.props(s.caption)}>
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
  onFilter
}: {
  projects?: ProjectStatsRow[];
  active?: string;
  onFilter: (repo: string | undefined) => void;
}) {
  return (
    <Panel title="Cost by project">
      {!projects ? (
        <PanelSkeleton />
      ) : projects.length === 0 ? (
        <PanelEmpty label="No reviews for these filters." />
      ) : (
        <div {...stylex.props(s.scrollX)}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead style={s.right}>Reviews</TableHead>
                <TableHead style={s.right}>Avg time</TableHead>
                <TableHead style={s.right}>Tokens</TableHead>
                <TableHead style={s.right}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const [owner, name] = p.repo_full_name.split("/");
                const isActive = active === p.repo_full_name;
                return (
                  <TableRow key={p.repo_full_name} style={isActive ? s.rowActive : undefined}>
                    <TableCell style={s.cellTight}>
                      <div {...stylex.props(shared.rowTight)}>
                        {owner && name ? (
                          <Link
                            to="/repos/$owner/$name"
                            params={{ owner, name }}
                            {...stylex.props(s.monoLink)}
                          >
                            {p.repo_full_name}
                          </Link>
                        ) : (
                          <span {...stylex.props(s.mono, s.z200)}>{p.repo_full_name}</span>
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
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                      {p.reviews}
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                      {formatSeconds(p.avg_duration) ?? "—"}
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                      {formatTokens(p.tokens) ?? "—"}
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z200]}>
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
  onFilter
}: {
  models?: ModelStatsRow[];
  active?: string;
  onFilter: (model: string | undefined) => void;
}) {
  return (
    <Panel title="Cost by model">
      {!models ? (
        <PanelSkeleton />
      ) : models.length === 0 ? (
        <PanelEmpty label="No models for these filters." />
      ) : (
        <div {...stylex.props(s.scrollX)}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead style={s.right}>Reviews</TableHead>
                <TableHead style={s.right}>Tokens</TableHead>
                <TableHead style={s.right}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => {
                const isActive = active === m.model;
                return (
                  <TableRow key={m.model} style={isActive ? s.rowActive : undefined}>
                    <TableCell style={s.cellTight}>
                      {/* No detail page for a model, so the whole name is the filter. */}
                      <button
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => onFilter(isActive ? undefined : m.model)}
                        {...stylex.props(
                          s.modelButton,
                          isActive ? s.modelButtonOn : s.modelButtonOff,
                        )}
                      >
                        {m.model}
                      </button>
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                      {m.reviews}
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                      {formatTokens(m.tokens) ?? "—"}
                    </TableCell>
                    <TableCell style={[s.cellTight, s.right, shared.tabular, s.z200]}>
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
        <PanelSkeleton />
      ) : rows.length === 0 ? (
        <PanelEmpty label="Nothing costed yet." />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} {...stylex.props(s.listItem)}>
              <Link
                to="/reviews/$id"
                params={{ id: String(r.id) }}
                {...stylex.props(s.costLink)}
              >
                <div {...stylex.props(shared.fill)}>
                  <div {...stylex.props(shared.truncate, s.costRepo)}>
                    {r.repo_full_name}
                    {r.pr_number > 0 ? `#${r.pr_number}` : ""}
                  </div>
                  {r.model && <div {...stylex.props(s.xs, s.z500, shared.truncate)}>{r.model}</div>}
                </div>
                {r.tokens != null && (
                  <span {...stylex.props(s.costTokens)}>{formatTokens(r.tokens)}</span>
                )}
                <span {...stylex.props(s.costValue)}>{formatCost(r.cost)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TriggerMix({ triggers }: { triggers?: TriggerStatsRow[] }) {
  const items = (triggers ?? []).map((t, i) => ({
    key: t.trigger,
    label: triggerLabel(t.trigger) ?? t.trigger,
    count: t.count,
    color: TRIGGER_COLORS[i % TRIGGER_COLORS.length]!
  }));
  return (
    <Panel title="How reviews start">
      {!triggers ? (
        <PanelSkeleton rows={2} />
      ) : items.length === 0 ? (
        <PanelEmpty label="No triggers recorded." />
      ) : (
        <MixBar items={items} />
      )}
    </Panel>
  );
}

function SeverityMix({ severity }: { severity?: SeverityStatsRow[] }) {
  const items = (severity ?? []).map((row) => ({
    key: row.severity,
    label: row.severity,
    count: row.count,
    color: SEVERITY_COLORS[row.severity] ?? UNKNOWN_SEVERITY_COLOR
  }));
  return (
    <Panel title="Findings by severity">
      {!severity ? (
        <PanelSkeleton rows={2} />
      ) : items.length === 0 ? (
        <PanelEmpty label="No findings yet." />
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
        <PanelSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <PanelEmpty label="No reviews match these filters." />
      ) : (
        <div {...stylex.props(s.scrollX)}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={s.headNarrow}>#</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead style={s.right}>Took</TableHead>
                <TableHead style={s.right}>Cost</TableHead>
                <TableHead style={s.right}>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell style={[s.cellTight, shared.tabular, s.z500]}>{r.id}</TableCell>
                  <TableCell style={s.cellTight}>
                    <Link
                      to="/reviews/$id"
                      params={{ id: String(r.id) }}
                      {...stylex.props(s.monoLink, s.nowrap)}
                    >
                      {r.repo_full_name}
                      {r.pr_number > 0 ? `#${r.pr_number}` : ""}
                    </Link>
                    {r.model && (
                      <div {...stylex.props(s.xs, s.z600, shared.truncate)}>{r.model}</div>
                    )}
                  </TableCell>
                  <TableCell style={s.cellTight}>
                    <Badge status={r.status} />
                  </TableCell>
                  <TableCell style={[s.cellTight, s.xs, s.z400]}>
                    {triggerLabel(r.trigger) ?? "—"}
                  </TableCell>
                  <TableCell style={[s.cellTight, s.right, shared.tabular, s.z400]}>
                    {r.completed_at
                      ? (formatSeconds(r.completed_at - r.created_at) ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell style={[s.cellTight, s.right, shared.tabular, s.z200]}>
                    {formatCost(r.cost) ?? "—"}
                  </TableCell>
                  <TableCell
                    style={[s.cellTight, s.right, shared.tabular, s.z500, s.nowrap]}
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

// ---------------------------------------------------------------------------
// Chart panels. Hand-rolled like CostTrend — no chart library. Every one of
// these can be handed an empty window, which is a normal outcome, so each guards
// its own max (Math.max over an empty array is -Infinity) and renders an empty
// state rather than a NaN.
// ---------------------------------------------------------------------------

function Reliability({ rows }: { rows?: ReliabilityRow[] }) {
  const totals = (rows ?? []).reduce(
    (a, r) => {
      a.completed += r.completed;
      a.failed += r.failed;
      a.inFlight += r.in_flight;
      return a;
    },
    { completed: 0, failed: 0, inFlight: 0 },
  );
  // Only settled reviews have an outcome. With none, the rate is undefined —
  // a dash, not 0%.
  const settled = totals.completed + totals.failed;
  const rate = settled === 0 ? null : (totals.completed / settled) * 100;

  return (
    <Panel title="Reliability">
      {!rows ? (
        <PanelSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <PanelEmpty label="No reviews in this window." />
      ) : (
        <div {...stylex.props(s.chartBody)}>
          <div {...stylex.props(s.rateRow)}>
            <span {...stylex.props(s.rate)}>
              {rate === null ? "—" : `${rate.toFixed(1)}%`}
            </span>
            <span {...stylex.props(s.rateSub)}>
              {settled === 0
                ? "nothing settled yet"
                : `${totals.completed} of ${settled} succeeded`}
            </span>
          </div>
          <div {...stylex.props(s.chartGap)}>
            {/* Stack order matches the legend: failed on top, so a bad day
                reads as a red cap rather than a hidden slice. */}
            <StackedBarChart
              bars={rows.map((r) => ({
                key: r.day,
                title: `${r.day} · ${r.completed} completed · ${r.failed} failed${
                  r.in_flight ? ` · ${r.in_flight} in flight` : ""
                }`,
                segments: [
                  { key: "in_flight", value: r.in_flight, style: outcome.inFlight },
                  { key: "failed", value: r.failed, style: outcome.failed },
                  {
                    key: "completed",
                    value: r.completed,
                    style: [outcome.completed, BAR_ROUNDED_BOTTOM]
                  },
                ]
              }))}
            />
          </div>
          <div {...stylex.props(s.legendRow)}>
            <LegendDot style={outcome.completed} label={`completed ${totals.completed}`} />
            <LegendDot style={outcome.failed} label={`failed ${totals.failed}`} />
            {totals.inFlight > 0 && (
              <LegendDot style={outcome.inFlight} label={`in flight ${totals.inFlight}`} />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function LatencyTrend({ rows, truncated }: { rows?: LatencyDayRow[]; truncated?: boolean }) {
  // Scale on p95 — the taller of the two series — so p50 never overflows.
  const max = scaleMax((rows ?? []).map((r) => r.p95 ?? 0));
  return (
    <Panel title="Latency trend">
      {!rows ? (
        <PanelSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <PanelEmpty label="No completed reviews in this window." />
      ) : (
        <div {...stylex.props(s.chartBody)}>
          <div {...stylex.props(s.latencyRow)}>
            {rows.map((r) => (
              <div
                key={r.day}
                {...stylex.props(shared.fill, s.latencyColumn)}
                title={`${r.day} · p50 ${formatSeconds(r.p50) ?? "—"} · p95 ${
                  formatSeconds(r.p95) ?? "—"
                } · ${r.count} review${r.count === 1 ? "" : "s"}`}
              >
                {/* p95 as the pale column, p50 as the solid one inside it —
                    two bars, no line maths, same idiom as the cost trend. */}
                <div
                  {...stylex.props(
                    s.latencyBar,
                    s.latencyP95,
                    s.barHeight(`${Math.max(2, ((r.p95 ?? 0) / max) * 100)}%`),
                  )}
                />
                <div
                  {...stylex.props(
                    s.latencyBar,
                    s.latencyP50,
                    s.barHeight(`${Math.max(2, ((r.p50 ?? 0) / max) * 100)}%`),
                  )}
                />
              </div>
            ))}
          </div>
          <div {...stylex.props(s.legendRow, s.legendRowCentred)}>
            <LegendDot style={latency.p50} label="p50" />
            <LegendDot style={latency.p95} label="p95" />
            <span {...stylex.props(s.pushRight)}>
              {rows[0]!.day} → {rows[rows.length - 1]!.day}
            </span>
          </div>
          {truncated && (
            <p {...stylex.props(s.truncatedNote)}>
              Window capped at 5000 completed reviews; trend covers the oldest of them.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

const SEVERITY_ORDER = ["blocking", "question", "nit"] as const;

function FindingsTrend({ rows }: { rows?: FindingsDailyRow[] }) {
  // Pivot the (day, severity) rows into one stacked bar per day.
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows ?? []) {
    const bucket = byDay.get(r.day) ?? {};
    bucket[r.severity] = (bucket[r.severity] ?? 0) + r.count;
    byDay.set(r.day, bucket);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const totalOf = (m: Record<string, number>) => Object.values(m).reduce((sum, n) => sum + n, 0);
  const grand = days.reduce((sum, [, m]) => sum + totalOf(m), 0);

  return (
    <Panel title="Findings per day">
      {!rows ? (
        <PanelSkeleton rows={6} />
      ) : days.length === 0 ? (
        <PanelEmpty label="No findings in this window." />
      ) : (
        <div {...stylex.props(s.chartBody)}>
          <StackedBarChart
            bars={days.map(([day, mix]) => ({
              key: day,
              title: `${day} · ${SEVERITY_ORDER.filter((sev) => mix[sev])
                .map((sev) => `${mix[sev]} ${sev}`)
                .join(" · ")}`,
              // Filtered before the map so `i` indexes the slices that actually
              // render — only the last one gets the rounded bottom.
              segments: SEVERITY_ORDER.filter((sev) => mix[sev]).map((sev, i) => ({
                key: sev,
                value: mix[sev]!,
                style:
                  i === SEVERITY_ORDER.length - 1
                    ? [SEVERITY_COLORS[sev]!, BAR_ROUNDED_BOTTOM]
                    : SEVERITY_COLORS[sev]!
              }))
            }))}
          />
          <div {...stylex.props(s.legendRow)}>
            {SEVERITY_ORDER.map((sev) => (
              <LegendDot key={sev} style={SEVERITY_COLORS[sev]!} label={sev} />
            ))}
            <span {...stylex.props(s.pushRight)}>{grand} total</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function TopFiles({ rows }: { rows?: TopFileRow[] }) {
  const max = scaleMax((rows ?? []).map((r) => r.count));
  return (
    <Panel title="Files with the most findings">
      {!rows ? (
        <PanelSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <PanelEmpty label="No findings with a file in this window." />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.path} {...stylex.props(s.listItemFaint, s.fileItem)}>
              {/* Horizontal bar behind the label, so the row reads as both a
                  list entry and a magnitude. */}
              <div
                aria-hidden
                {...stylex.props(s.fileBar, s.barWidth(`${(r.count / max) * 100}%`))}
              />
              <div {...stylex.props(s.fileRow)}>
                <span {...stylex.props(shared.truncate, s.filePath)} title={r.path}>
                  {r.path}
                </span>
                <span {...stylex.props(s.fileCount)}>{r.count}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
