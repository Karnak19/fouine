import { useState, useEffect, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as stylex from "@stylexjs/stylex";
import { color, font, leading, radius, shadow, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";
import { api, type ReviewRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModelInput } from "@/components/model-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ArrowLeft, Trash2, ExternalLink, ChevronRight, Sparkles, FolderX } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { timeAgo, formatCost, formatSeconds } from "@/lib/format";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { Stat } from "@/components/stat";

// Tailwind's `animate-pulse` for the loading skeletons. Restated locally: the
// @keyframes only exist while some className references the utility.
const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 }
});

const s = stylex.create({
  // space-y-6 max-w-5xl
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.x24,
    maxWidth: space.x1024
  },
  titleRow: { display: "flex", alignItems: "center", gap: space.x12 },
  h1: {
    fontSize: text.xl2,
    lineHeight: leading.xl2,
    fontWeight: 700,
    fontFamily: font.mono
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x6,
    borderRadius: radius.full,
    paddingInline: space.x8,
    paddingBlock: space.x2,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    // `ring-1` was a non-inset box-shadow; outline at offset 0 paints in the
    // same place and follows the pill radius, without a shadow token.
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineOffset: "0"
  },
  pillOn: {
    backgroundColor: `color-mix(in oklab, ${color.ember950} 50%, transparent)`,
    color: color.ember300,
    outlineColor: `color-mix(in oklab, ${color.ember800} 40%, transparent)`
  },
  pillOff: {
    backgroundColor: `color-mix(in oklab, ${color.zinc800} 60%, transparent)`,
    color: color.zinc400,
    outlineColor: `color-mix(in oklab, ${color.zinc700} 50%, transparent)`
  },
  pillDotOn: { backgroundColor: color.ember400 },
  pillDotOff: { backgroundColor: color.zinc500 },
  ghostLink: {
    transitionProperty: "color, background-color",
    transitionDuration: "150ms"
  },
  subtle: { marginTop: space.x4 },
  // KPI strip. `divide-x divide-y sm:divide-y-0` was a `& > :not(:last-child)`
  // rule on this container; StyleX can't reach children, so the hairline moves
  // onto each cell via <Stat style> (see `cell` below).
  strip: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (min-width: 640px)": "repeat(4, minmax(0, 1fr))"
    },
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
  layout: {
    display: "grid",
    gap: space.x24,
    gridTemplateColumns: {
      default: null,
      "@media (min-width: 1024px)": `minmax(0, 1fr) ${space.x320}`
    },
    alignItems: { default: null, "@media (min-width: 1024px)": "start" }
  },
  // Config panel: second on desktop, first on a phone, and it sticks.
  aside: {
    order: { default: 1, "@media (min-width: 1024px)": 2 },
    position: { default: null, "@media (min-width: 1024px)": "sticky" },
    top: { default: null, "@media (min-width: 1024px)": space.x24 }
  },
  main: {
    order: { default: 2, "@media (min-width: 1024px)": 1 },
    display: "flex",
    flexDirection: "column",
    gap: space.x24
  },
  form: { display: "flex", flexDirection: "column", gap: space.x16 },
  // Plain block, not a column flex: a flex item is blockified, and that turns
  // the inline <label> into a full-width block sized by `line-height: 1`.
  // Tailwind's `space-y-1.5` margin-bottom was ignored on the label, and the
  // control below it is the last child — so no gap to reproduce here.
  field: { display: "block" },
  select: {
    display: "flex",
    height: space.x36,
    width: "100%",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc700,
    backgroundColor: color.zinc900,
    paddingInline: space.x12,
    paddingBlock: space.x4,
    fontSize: text.sm,
    lineHeight: leading.sm,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    outlineStyle: { default: null, ":focus-visible": "none" },
    // focus-visible:ring-1 ring-zinc-400 — a non-inset 1px box-shadow.
    boxShadow: {
      default: shadow.sm,
      ":focus-visible": `0 0 0 1px ${color.zinc400}, ${shadow.sm}`
    }
  },
  checkRow: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc300,
    userSelect: "none"
  },
  checkbox: { accentColor: color.zinc200 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.x8 },
  goneIcon: { color: color.zinc700 },
  goneLink: {
    marginTop: space.x12,
    fontSize: text.xs,
    lineHeight: leading.xs
  },
  skeleton: {
    borderRadius: radius.base,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  skelCrumb: { height: space.x16, width: space.x128 },
  skelTitle: { height: space.x32, width: space.x256 },
  skelBody: { height: space.x256, borderRadius: radius.lg },
  rowLink: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: { default: color.zinc300, ":hover": color.zinc100 },
    fontVariantNumeric: "tabular-nums"
  },
  headRight: { textAlign: "right" },
  headNarrow: { width: space.x32 },
  cellTime: { color: color.zinc500, fontSize: text.sm, lineHeight: leading.sm, textAlign: "right" },
  cellChevron: { color: color.zinc600 },
  cellCount: { textAlign: "right" },
  emptyNote: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc500 }
});

export default function RepoDetailPage() {
  const { owner, name } = useParams({ from: "/repos/$owner/$name" });
  const queryClient = useQueryClient();

  const { data: repo, isError } = useQuery({
    queryKey: ["repos", owner, name],
    queryFn: () => api.repos.get(owner, name),
    retry: false
  });

  const { data: reviews = [] as ReviewRow[] } = useQuery({
    queryKey: ["repos", owner, name, "reviews"],
    queryFn: () => api.repos.reviews(owner, name),
    // Fallback polling while a review runs, in case the SSE stream is down.
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      return list.some((r) => r.status === "running" || r.status === "pending") ? 5000 : false;
    }
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

  // Group PR reviews by PR — reviews come newest-first, so each group's head is
  // the latest run; groups sort by that latest run, newest PR activity first.
  const prGroups = useMemo(() => {
    const map = new Map<number, ReviewRow[]>();
    for (const r of reviews) {
      if (r.trigger === "improve") continue;
      const arr = map.get(r.pr_number);
      if (arr) arr.push(r);
      else map.set(r.pr_number, [r]);
    }
    return [...map.values()].sort((a, b) => b[0].id - a[0].id);
  }, [reviews]);

  // Repo-level insight computed from the reviews we already fetch — same shape as
  // the dashboard's stat strip, scoped to this repo. Improver runs don't count.
  const insight = useMemo(() => {
    const prReviews = reviews.filter((r) => r.trigger !== "improve");
    const completed = prReviews.filter((r) => r.status === "completed");
    const finished = completed.length + prReviews.filter((r) => r.status === "failed").length;
    const durations = completed
      .map((r) => (r.completed_at ?? 0) - r.created_at)
      .filter((d) => d > 0);
    return {
      count: prReviews.length,
      successRate: finished ? Math.round((completed.length / finished) * 100) : null,
      totalCost: prReviews.length ? prReviews.reduce((s, r) => s + (r.cost ?? 0), 0) : null,
      avgTime: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
    };
  }, [reviews]);

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  // null = inherit the global default; 1 = deny; 0 = explicitly allow.
  const [denyTestCommands, setDenyTestCommands] = useState<number | null>(null);

  // Only to show which way "inherit" currently resolves. Same query key as the
  // settings page, so it's usually already cached.
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });

  useEffect(() => {
    if (repo) {
      setModel(repo.model ?? "");
      setPrompt(repo.prompt ?? "");
      setEnabled(repo.enabled !== 0);
      setDenyTestCommands(repo.deny_test_commands ?? null);
    }
  }, [repo]);

  const updateMut = useMutation({
    mutationFn: () =>
      api.repos.update(owner, name, {
        model: model.trim() || undefined,
        prompt: prompt.trim() || undefined,
        enabled: enabled ? 1 : 0,
        // Explicit null clears the override — absent would mean "unchanged".
        deny_test_commands: denyTestCommands
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos", owner, name] })
  });

  const improveMut = useMutation({
    mutationFn: () => api.repos.improve(owner, name)
  });

  const deleteMut = useMutation({
    mutationFn: () => api.repos.delete(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      window.location.href = "/";
    }
  });

  // A repo:removed refetch 404s, so distinguish gone from still-loading —
  // otherwise a deleted repo shimmers forever.
  if (isError) {
    return (
      <div {...stylex.props(shared.emptyBox)}>
        <FolderX size={28} {...stylex.props(s.goneIcon)} />
        <p {...stylex.props(shared.emptyTitle)}>
          {owner}/{name} is no longer registered
        </p>
        <Link to="/repos" {...stylex.props(shared.ghostLink, s.goneLink)}>
          Back to repositories
        </Link>
      </div>
    );
  }

  if (!repo) {
    return (
      <div {...stylex.props(s.page)}>
        <div {...stylex.props(s.skeleton, s.skelCrumb)} />
        <div {...stylex.props(s.skeleton, s.skelTitle)} />
        <div {...stylex.props(s.skeleton, s.skelBody)} />
      </div>
    );
  }

  return (
    <div {...stylex.props(s.page)}>
      <Link to="/repos" {...stylex.props(shared.backLink)}>
        <ArrowLeft size={14} /> Repositories
      </Link>

      <div>
        <div {...stylex.props(s.titleRow)}>
          <h1 {...stylex.props(s.h1)}>{repo.full_name}</h1>
          <span {...stylex.props(s.pill, repo.enabled ? s.pillOn : s.pillOff)}>
            <span
              {...stylex.props(shared.dot, repo.enabled ? s.pillDotOn : s.pillDotOff)}
            />
            {repo.enabled ? "auto-review on" : "paused"}
          </span>
          <a
            href={`https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on GitHub"
            {...stylex.props(shared.ghostLink, s.ghostLink)}
          >
            <ExternalLink size={14} />
          </a>
          <LiveBadge status={status} />
        </div>
        <p {...stylex.props(shared.meta, s.subtle)}>Installation ID: {repo.installation_id}</p>
      </div>

      {insight.count > 0 && (
        <div {...stylex.props(s.strip)}>
          <Stat style={s.cell} label="Reviews" value={String(insight.count)} />
          <Stat
            style={s.cell}
            label="Success"
            value={insight.successRate == null ? "—" : `${insight.successRate}%`}
          />
          <Stat style={s.cell} label="Total cost" value={formatCost(insight.totalCost) ?? "—"} />
          <Stat style={s.cell} label="Avg review" value={formatSeconds(insight.avgTime) ?? "—"} />
        </div>
      )}

      <div {...stylex.props(s.layout)}>
        <div {...stylex.props(s.aside)}>
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMut.mutate();
                }}
                {...stylex.props(s.form)}
              >
                <div {...stylex.props(s.field)}>
                  <Label htmlFor="model">Model override</Label>
                  <ModelInput
                    id="model"
                    placeholder="provider/model (leave empty for default)"
                    value={model}
                    onChange={setModel}
                  />
                </div>
                <div {...stylex.props(s.field)}>
                  <Label htmlFor="prompt">Review prompt override</Label>
                  <Textarea
                    id="prompt"
                    rows={8}
                    placeholder="Custom review instructions for this repo..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>
                <div {...stylex.props(s.field)}>
                  <Label htmlFor="deny_test_commands">Tests, lint, typecheck, build</Label>
                  <select
                    id="deny_test_commands"
                    value={denyTestCommands === null ? "inherit" : String(denyTestCommands)}
                    onChange={(e) =>
                      setDenyTestCommands(e.target.value === "inherit" ? null : Number(e.target.value))
                    }
                    {...stylex.props(s.select)}
                  >
                    <option value="inherit">
                      Use global default (
                      {settings?.deny_test_commands === "1" ? "don't run them" : "run them"})
                    </option>
                    <option value="1">Don't run them on this repo</option>
                    <option value="0">Run them on this repo</option>
                  </select>
                </div>
                <label {...stylex.props(shared.row, s.checkRow)}>
                  <input
                    id="enabled"
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    {...stylex.props(shared.icon, s.checkbox)}
                  />
                  Auto-review new PRs on this repo
                </label>
                <div {...stylex.props(s.actions)}>
                  <Button type="submit" disabled={updateMut.isPending}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={improveMut.isPending || improveMut.isSuccess}
                    onClick={() => improveMut.mutate()}
                    title="Read human feedback on this repo's review threads and open a REVIEW.md PR"
                  >
                    <Sparkles size={14} />
                    {improveMut.isSuccess ? "Improver queued" : "Run improver"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Delete this repository?")) deleteMut.mutate();
                    }}
                  >
                    <Trash2 size={14} />
                    Delete
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div {...stylex.props(s.main)}>
          {improverRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Improver runs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead style={s.headRight}>Started</TableHead>
                      <TableHead style={s.headNarrow} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {improverRuns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            to="/reviews/$id"
                            params={{ id: String(r.id) }}
                            {...stylex.props(s.rowLink)}
                          >
                            #{r.id}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge status={r.status} />
                        </TableCell>
                        <TableCell
                          style={s.cellTime}
                          title={new Date(r.created_at * 1000).toLocaleString()}
                        >
                          {timeAgo(r.created_at)}
                        </TableCell>
                        <TableCell style={s.cellChevron}>
                          <Link to="/reviews/$id" params={{ id: String(r.id) }}>
                            <ChevronRight size={16} />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Reviews by PR</CardTitle>
            </CardHeader>
            <CardContent>
              {prGroups.length === 0 ? (
                <p {...stylex.props(s.emptyNote)}>No reviews yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PR</TableHead>
                      <TableHead style={s.headRight}>Reviews</TableHead>
                      <TableHead>Latest</TableHead>
                      <TableHead style={s.headRight}>Last run</TableHead>
                      <TableHead style={s.headNarrow} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prGroups.map((group) => {
                      const latest = group[0];
                      return (
                        <TableRow key={latest.pr_number}>
                          <TableCell>
                            <div {...stylex.props(shared.rowTight)}>
                              <Link
                                to="/repos/$owner/$name/pr/$number"
                                params={{ owner, name, number: String(latest.pr_number) }}
                                {...stylex.props(s.rowLink)}
                              >
                                #{latest.pr_number}
                              </Link>
                              <a
                                href={`https://github.com/${owner}/${name}/pull/${latest.pr_number}`}
                                target="_blank"
                                rel="noreferrer"
                                {...stylex.props(shared.ghostLink)}
                              >
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </TableCell>
                          <TableCell style={[shared.meta, shared.tabular, s.cellCount]}>{group.length}</TableCell>
                          <TableCell>
                            <Badge status={latest.status} />
                          </TableCell>
                          <TableCell
                            style={s.cellTime}
                            title={new Date(latest.created_at * 1000).toLocaleString()}
                          >
                            {timeAgo(latest.created_at)}
                          </TableCell>
                          <TableCell style={s.cellChevron}>
                            <Link
                              to="/repos/$owner/$name/pr/$number"
                              params={{ owner, name, number: String(latest.pr_number) }}
                            >
                              <ChevronRight size={16} />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
