import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useBlocker } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type ReviewRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModelInput } from "@/components/model-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  // null = inherit the global default; 1 = deny; 0 = explicitly allow.
  const [denyTestCommands, setDenyTestCommands] = useState<number | null>(null);
  const leaving = useRef(false);
  const [baseline, setBaseline] = useState({
    model: "",
    prompt: "",
    enabled: true,
    denyTestCommands: null as number | null,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Only to show which way "inherit" currently resolves. Same query key as the
  // settings page, so it's usually already cached.
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });

  // Hydrate once per repo, not on every refetch (SSE invalidation, polling)
  // — otherwise those clobber whatever the user is typing. Keyed on full_name
  // rather than a mount-only guard because this component instance persists
  // across repos when navigating between them.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (repo && hydratedFor.current !== repo.full_name) {
      hydratedFor.current = repo.full_name;
      const m = repo.model ?? "";
      const p = repo.prompt ?? "";
      const e = repo.enabled !== 0;
      const d = repo.deny_test_commands ?? null;
      setModel(m);
      setPrompt(p);
      setEnabled(e);
      setDenyTestCommands(d);
      setBaseline({ model: m, prompt: p, enabled: e, denyTestCommands: d });
    }
  }, [repo]);

  const dirty =
    model !== baseline.model ||
    prompt !== baseline.prompt ||
    enabled !== baseline.enabled ||
    denyTestCommands !== baseline.denyTestCommands;

  const resetForm = () => {
    setModel(baseline.model);
    setPrompt(baseline.prompt);
    setEnabled(baseline.enabled);
    setDenyTestCommands(baseline.denyTestCommands);
  };

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const {
    proceed: proceedNav,
    reset: cancelNavBlock,
    status: navBlockStatus,
  } = useBlocker({
    // A confirmed delete leaves on purpose; the dirty form must not intercept it.
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const updateMut = useMutation({
    mutationFn: () =>
      api.repos.update(owner, name, {
        model: model.trim() || undefined,
        prompt: prompt.trim() || undefined,
        enabled: enabled ? 1 : 0,
        // Explicit null clears the override — absent would mean "unchanged".
        deny_test_commands: denyTestCommands,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
      setBaseline({ model, prompt, enabled, denyTestCommands });
    },
    onError: (e: Error) => toast.error("Couldn't save configuration", { description: e.message }),
  });

  const improveMut = useMutation({
    mutationFn: () => api.repos.improve(owner, name),
    onError: (e: Error) => toast.error("Couldn't queue improver", { description: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.repos.delete(owner, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      leaving.current = true;
      navigate({ to: "/repos" });
    },
    onError: (e: Error) => toast.error("Couldn't delete repository", { description: e.message }),
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

  return (
    <div className="space-y-6">
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {owner}/{name}?</DialogTitle>
            <DialogDescription>
              Removes the repository from fouine. Its reviews are kept, and this does not touch
              GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={navBlockStatus === "blocked"} onOpenChange={(open) => !open && cancelNavBlock?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This repo's configuration has unsaved changes. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => cancelNavBlock?.()}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => proceedNav?.()}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <p className="text-xs text-zinc-500 mt-1">
          Reviews run when a PR is opened, pushed to, reopened, or marked ready for review, and on a{" "}
          <span className="font-mono">/fouine</span> comment.
        </p>
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
              <ModelInput
                id="model"
                placeholder="provider/model (leave empty for default)"
                value={model}
                onChange={setModel}
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
            <div className="space-y-1.5">
              <Label htmlFor="deny_test_commands">Let the reviewer run tests, lint, typecheck, build</Label>
              <select
                id="deny_test_commands"
                className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                value={denyTestCommands === null ? "inherit" : String(denyTestCommands)}
                onChange={(e) =>
                  setDenyTestCommands(e.target.value === "inherit" ? null : Number(e.target.value))
                }
              >
                <option value="inherit">
                  Use global default (
                  {settings?.deny_test_commands === "1" ? "don't run them" : "run them"})
                </option>
                <option value="1">Don't run them on this repo</option>
                <option value="0">Run them on this repo</option>
              </select>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!dirty || updateMut.isPending}>
                Save
              </Button>
              {dirty && (
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  Reset
                </Button>
              )}
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
              <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Run improver rereads recent reviews on this repo and opens a PR updating REVIEW.md to fix
              issues it keeps missing.
            </p>
          </form>
        </CardContent>
      </Card>
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
                    <TableCell className="text-zinc-500">
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
          {reviewsError ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-8 text-center">
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
                      <TableCell className="text-zinc-500">
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
