import { useState, useEffect, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  parseTriggers,
  DEFAULT_TRIGGERS,
  type ReviewRow,
  type RepoRow,
  type ReviewTriggers,
  type Settings,
} from "@/lib/api";
import { TriggerFields } from "@/components/trigger-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Trash2, ExternalLink, ChevronRight, Sparkles, FolderX } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { timeAgo, formatCost, formatSeconds } from "@/lib/format";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { cn } from "@/lib/utils";
import { Stat } from "@/components/stat";

export default function RepoDetailPage() {
  const { owner, name } = useParams({ from: "/repos/$owner/$name" });
  const queryClient = useQueryClient();

  const { data: repo, isError } = useQuery({
    queryKey: ["repos", owner, name],
    queryFn: () => api.repos.get(owner, name),
    retry: false,
  });

  const { data: reviews = [] as ReviewRow[] } = useQuery({
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
      avgTime: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    };
  }, [reviews]);

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (repo) {
      setModel(repo.model ?? "");
      setPrompt(repo.prompt ?? "");
      setEnabled(repo.enabled !== 0);
    }
  }, [repo]);

  const updateMut = useMutation({
    mutationFn: () =>
      api.repos.update(owner, name, {
        model: model.trim() || undefined,
        prompt: prompt.trim() || undefined,
        enabled: enabled ? 1 : 0,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos", owner, name] }),
  });

  const improveMut = useMutation({
    mutationFn: () => api.repos.improve(owner, name),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.repos.delete(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      window.location.href = "/";
    },
  });

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
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="h-4 w-32 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-8 w-64 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-64 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        to="/repos"
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Repositories
      </Link>

      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold font-mono">{repo.full_name}</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 tabular-nums",
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
            className="text-zinc-500 transition-colors hover:text-zinc-300"
            aria-label="Open on GitHub"
          >
            <ExternalLink size={14} />
          </a>
          <LiveBadge status={status} />
        </div>
        <p className="text-sm text-zinc-400 mt-1">Installation ID: {repo.installation_id}</p>
      </div>

      {insight.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-zinc-800 divide-x divide-y sm:divide-y-0 divide-zinc-800 overflow-hidden bg-zinc-900/40">
          <Stat label="Reviews" value={String(insight.count)} />
          <Stat
            label="Success"
            value={insight.successRate == null ? "—" : `${insight.successRate}%`}
          />
          <Stat label="Total cost" value={formatCost(insight.totalCost) ?? "—"} />
          <Stat label="Avg review" value={formatSeconds(insight.avgTime) ?? "—"} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="order-1 lg:order-2 lg:sticky lg:top-6">
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
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="model">Model override</Label>
              <Input
                id="model"
                placeholder="provider/model (leave empty for default)"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Review prompt override</Label>
              <Textarea
                id="prompt"
                rows={8}
                placeholder="Custom review instructions for this repo..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
              <input
                id="enabled"
                type="checkbox"
                className="h-4 w-4 accent-zinc-200"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Auto-review new PRs on this repo
            </label>
            <div className="flex flex-wrap gap-2">
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

      <div className="mt-6">
        <TriggersCard repo={repo} owner={owner} name={name} />
      </div>
      </div>

      <div className="order-2 lg:order-1 space-y-6">
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
                  <TableHead className="text-right">Started</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {improverRuns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/reviews/$id"
                        params={{ id: String(r.id) }}
                        className="text-sm text-zinc-300 hover:text-zinc-100 tabular-nums"
                      >
                        #{r.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge status={r.status} />
                    </TableCell>
                    <TableCell
                      className="text-zinc-500 text-sm text-right"
                      title={new Date(r.created_at * 1000).toLocaleString()}
                    >
                      {timeAgo(r.created_at)}
                    </TableCell>
                    <TableCell className="text-zinc-600">
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
            <p className="text-sm text-zinc-500">No reviews yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR</TableHead>
                  <TableHead className="text-right">Reviews</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead className="text-right">Last run</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prGroups.map((group) => {
                  const latest = group[0];
                  return (
                    <TableRow key={latest.pr_number}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Link
                            to="/repos/$owner/$name/pr/$number"
                            params={{ owner, name, number: String(latest.pr_number) }}
                            className="text-sm text-zinc-300 hover:text-zinc-100 tabular-nums"
                          >
                            #{latest.pr_number}
                          </Link>
                          <a
                            href={`https://github.com/${owner}/${name}/pull/${latest.pr_number}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-zinc-500 hover:text-zinc-300"
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm text-right tabular-nums">
                        {group.length}
                      </TableCell>
                      <TableCell>
                        <Badge status={latest.status} />
                      </TableCell>
                      <TableCell
                        className="text-zinc-500 text-sm text-right"
                        title={new Date(latest.created_at * 1000).toLocaleString()}
                      >
                        {timeAgo(latest.created_at)}
                      </TableCell>
                      <TableCell className="text-zinc-600">
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

// Per-repo trigger rules. Three states, and the difference between the last two
// matters: inheriting the global rules (triggers = null), overriding with a set
// of events, or overriding with an empty set (never auto-review). The checkbox
// is what separates "I haven't chosen" from "I chose nothing".
function TriggersCard({ repo, owner, name }: { repo: RepoRow; owner: string; name: string }) {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const globalTriggers = parseTriggers((settings as Settings | undefined)?.review_triggers) ??
    DEFAULT_TRIGGERS;

  const stored = parseTriggers(repo.triggers);
  const [override, setOverride] = useState(stored !== null);
  // Seeded from the global rules when there's no override yet, so ticking the
  // box starts from what the repo is doing today rather than from nothing.
  const [triggers, setTriggers] = useState<ReviewTriggers>(stored ?? globalTriggers);

  useEffect(() => {
    const next = parseTriggers(repo.triggers);
    setOverride(next !== null);
    setTriggers(next ?? globalTriggers);
    // globalTriggers is derived from the settings query; re-seed when either moves.
  }, [repo.triggers, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: () => api.repos.setTriggers(owner, name, override ? triggers : null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos", owner, name] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review triggers</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
          className="space-y-4"
        >
          <label className="flex items-start gap-2 text-sm text-zinc-300 select-none">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-zinc-200"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            <span>
              Override the global rules
              <span className="block text-xs text-zinc-500">
                {override
                  ? "This repo uses the events below."
                  : `Inheriting the global rules: ${
                      globalTriggers.actions.length
                        ? globalTriggers.actions.join(", ")
                        : "no events"
                    }${globalTriggers.reviewDrafts ? ", drafts included" : ""}.`}
              </span>
            </span>
          </label>
          <div className={override ? undefined : "opacity-50"}>
            <TriggerFields
              value={triggers}
              onChange={setTriggers}
              idPrefix="repo_trigger"
              disabled={!override}
            />
          </div>
          {override && triggers.actions.length === 0 && (
            <p className="text-xs text-amber-400">
              No events selected — this repo will only be reviewed from a <code>/review</code>{" "}
              comment.
            </p>
          )}
          <Button type="submit" disabled={saveMut.isPending}>
            Save triggers
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
