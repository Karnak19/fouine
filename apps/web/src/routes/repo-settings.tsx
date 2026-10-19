import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams, useNavigate, useBlocker, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ModelInput } from "@/components/model-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, ChevronRight, Trash2, FolderX } from "lucide-react";
import { AUTOMATION_LEVELS, automationLevel, presetFlags } from "@/lib/automation";

const SELECT_CLASS =
  "flex h-9 w-full min-w-0 max-w-sm rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm shadow-sm transition-colors focus-ring disabled:opacity-50";

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      <div className="mt-3 min-w-0 space-y-4">{children}</div>
    </section>
  );
}

// One inline disclosure row inside the Agents list. The body stays mounted
// (just hidden) so field ids and native validation keep working while closed.
function AgentRow({
  id,
  name,
  open,
  onToggle,
  edited,
  summary,
  children,
}: {
  id: string;
  name: string;
  open: boolean;
  onToggle: () => void;
  edited: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-agent={id}>
      <button
        type="button"
        id={`agent-${id}-trigger`}
        aria-expanded={open}
        aria-controls={`agent-${id}-body`}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900/60 focus-ring"
      >
        <ChevronRight
          size={14}
          className={`mt-1 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-100">{name}</span>
            {edited && <span className="text-xs text-zinc-300">edited</span>}
          </span>
          <span className="block text-xs text-zinc-500">{summary}</span>
        </span>
      </button>
      <div
        id={`agent-${id}-body`}
        role="group"
        aria-labelledby={`agent-${id}-trigger`}
        hidden={!open}
        className="space-y-4 px-4 pb-4 pl-[2.75rem]"
      >
        {children}
      </div>
    </div>
  );
}

// Overridden parts read brighter than defaults; ember stays out of it.
function Part({ on, mono, children }: { on: boolean; mono?: boolean; children: ReactNode }) {
  return <span className={`${on ? "text-zinc-100" : "text-zinc-500"} ${mono && on ? "font-mono" : ""}`}>{children}</span>;
}

function Sep() {
  return <span className="text-zinc-600"> · </span>;
}

export default function RepoSettingsPage() {
  const { owner, name } = useParams({ from: "/repos/$owner/$name/settings" });
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

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  // null = inherit the global default; 1 = deny; 0 = explicitly allow.
  const [denyTestCommands, setDenyTestCommands] = useState<number | null>(null);
  // null = inherit; 1 = on; 0 = explicitly off.
  const [autoMerge, setAutoMerge] = useState<number | null>(null);
  // null = inherit the global merge method.
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase" | null>(null);
  // null = inherit; 1 = on; 0 = explicitly off.
  const [refineEnabled, setRefineEnabled] = useState<number | null>(null);
  const [refinePrompt, setRefinePrompt] = useState("");
  // Empty string = inherit the review model override, then the global default.
  const [refineModel, setRefineModel] = useState("");
  // null = inherit; 1 = on; 0 = explicitly off.
  const [implementEnabled, setImplementEnabled] = useState<number | null>(null);
  // Empty string = inherit the global label.
  const [implementLabel, setImplementLabel] = useState("");
  const [implementPrompt, setImplementPrompt] = useState("");
  // Empty string = inherit the review model override, then the global default.
  const [implementModel, setImplementModel] = useState("");
  // null = inherit; 1 = on; 0 = explicitly off.
  const [autoReady, setAutoReady] = useState<number | null>(null);
  const leaving = useRef(false);
  const [baseline, setBaseline] = useState({
    model: "",
    prompt: "",
    enabled: true,
    denyTestCommands: null as number | null,
    autoMerge: null as number | null,
    mergeMethod: null as "merge" | "squash" | "rebase" | null,
    refineEnabled: null as number | null,
    refinePrompt: "",
    refineModel: "",
    implementEnabled: null as number | null,
    implementLabel: "",
    implementPrompt: "",
    implementModel: "",
    autoReady: null as number | null,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [openAgents, setOpenAgents] = useState({ reviewer: false, refiner: false, implementer: false });
  type AgentId = keyof typeof openAgents;
  const openAgent = (id: AgentId) => setOpenAgents((o) => (o[id] ? o : { ...o, [id]: true }));
  const toggleAgent = (id: AgentId) => setOpenAgents((o) => ({ ...o, [id]: !o[id] }));

  // Only to show which way "inherit" currently resolves. Same query key as the
  // settings page, so it's usually already cached.
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });

  const globals = {
    auto_merge: settings?.auto_merge === "1",
    refine_enabled: settings?.refine_enabled === "1",
    implement_enabled: settings?.implement_enabled === "1",
    auto_ready: settings?.auto_ready === "1",
  };
  const currentLevel = automationLevel(
    {
      enabled: enabled ? 1 : 0,
      auto_merge: autoMerge,
      refine_enabled: refineEnabled,
      implement_enabled: implementEnabled,
      auto_ready: autoReady,
    },
    globals,
  );
  const onOff = (v: number | null, g: boolean) => ((v ?? (g ? 1 : 0)) === 1 ? "on" : "off");

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
      const am = repo.auto_merge ?? null;
      const mm = repo.merge_method ?? null;
      const re = repo.refine_enabled ?? null;
      const rp = repo.refine_prompt ?? "";
      const rm = repo.refine_model ?? "";
      const ie = repo.implement_enabled ?? null;
      const il = repo.implement_label ?? "";
      const ip = repo.implement_prompt ?? "";
      const im = repo.implement_model ?? "";
      const ar = repo.auto_ready ?? null;
      setModel(m);
      setPrompt(p);
      setEnabled(e);
      setDenyTestCommands(d);
      setAutoMerge(am);
      setMergeMethod(mm);
      setRefineEnabled(re);
      setRefinePrompt(rp);
      setRefineModel(rm);
      setImplementEnabled(ie);
      setImplementLabel(il);
      setImplementPrompt(ip);
      setImplementModel(im);
      setAutoReady(ar);
      setBaseline({
        model: m,
        prompt: p,
        enabled: e,
        denyTestCommands: d,
        autoMerge: am,
        mergeMethod: mm,
        refineEnabled: re,
        refinePrompt: rp,
        refineModel: rm,
        implementEnabled: ie,
        implementLabel: il,
        implementPrompt: ip,
        implementModel: im,
        autoReady: ar,
      });
    }
  }, [repo]);

  const dirty =
    model !== baseline.model ||
    prompt !== baseline.prompt ||
    enabled !== baseline.enabled ||
    denyTestCommands !== baseline.denyTestCommands ||
    autoMerge !== baseline.autoMerge ||
    mergeMethod !== baseline.mergeMethod ||
    refineEnabled !== baseline.refineEnabled ||
    refinePrompt !== baseline.refinePrompt ||
    refineModel !== baseline.refineModel ||
    implementEnabled !== baseline.implementEnabled ||
    implementLabel !== baseline.implementLabel ||
    implementPrompt !== baseline.implementPrompt ||
    implementModel !== baseline.implementModel ||
    autoReady !== baseline.autoReady;

  const resetForm = () => {
    setModel(baseline.model);
    setPrompt(baseline.prompt);
    setEnabled(baseline.enabled);
    setDenyTestCommands(baseline.denyTestCommands);
    setAutoMerge(baseline.autoMerge);
    setMergeMethod(baseline.mergeMethod);
    setRefineEnabled(baseline.refineEnabled);
    setRefinePrompt(baseline.refinePrompt);
    setRefineModel(baseline.refineModel);
    setImplementEnabled(baseline.implementEnabled);
    setImplementLabel(baseline.implementLabel);
    setImplementPrompt(baseline.implementPrompt);
    setImplementModel(baseline.implementModel);
    setAutoReady(baseline.autoReady);
  };

  // Effective auto-merge resolves inherit against the global default, using
  // the same reading the inherit option label shows. While settings are still
  // loading, inherit could resolve either way — fail closed and confirm
  // rather than risk a silent arm.
  const autoMergeEffective = autoMerge ?? (settings?.auto_merge === "1" ? 1 : 0);
  const autoMergeWas = baseline.autoMerge ?? (settings?.auto_merge === "1" ? 1 : 0);
  const armingAutoMerge =
    (autoMergeEffective === 1 || (autoMerge === null && settings === undefined)) &&
    (autoMergeWas !== 1 || settings === undefined);
  const mergeMethodActive = autoMergeEffective === 1;

  // Arming auto-merge lets a bot merge code, so a save that flips it off to
  // on asks for confirmation instead of saving silently. This also covers
  // preset-driven arming via the Automation radios, which flows through Save.
  const requestSave = () => {
    if (dirty && armingAutoMerge) setMergeConfirmOpen(true);
    else updateMut.mutate();
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
        auto_merge: autoMerge,
        merge_method: mergeMethod,
        refine_enabled: refineEnabled,
        refine_prompt: refinePrompt.trim() || undefined,
        refine_model: refineModel.trim() || null,
        implement_enabled: implementEnabled,
        implement_label: implementLabel.trim() || null,
        implement_prompt: implementPrompt.trim() || undefined,
        implement_model: implementModel.trim() || null,
        auto_ready: autoReady,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos", owner, name] });
      setBaseline({
        model,
        prompt,
        enabled,
        denyTestCommands,
        autoMerge,
        mergeMethod,
        refineEnabled,
        refinePrompt,
        refineModel,
        implementEnabled,
        implementLabel,
        implementPrompt,
        implementModel,
        autoReady,
      });
      toast.success("Configuration saved");
    },
    onError: (e: Error) => toast.error("Couldn't save configuration", { description: e.message }),
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

  const refineOn = (refineEnabled ?? (globals.refine_enabled ? 1 : 0)) === 1;
  const implementOn = (implementEnabled ?? (globals.implement_enabled ? 1 : 0)) === 1;
  const reviewerEdited =
    model !== baseline.model ||
    prompt !== baseline.prompt ||
    enabled !== baseline.enabled ||
    denyTestCommands !== baseline.denyTestCommands ||
    autoMerge !== baseline.autoMerge;
  const refinerEdited =
    refineEnabled !== baseline.refineEnabled ||
    refineModel !== baseline.refineModel ||
    refinePrompt !== baseline.refinePrompt;
  const implementerEdited =
    implementEnabled !== baseline.implementEnabled ||
    autoReady !== baseline.autoReady ||
    implementLabel !== baseline.implementLabel ||
    implementModel !== baseline.implementModel ||
    implementPrompt !== baseline.implementPrompt;
  const agentSummary = (run: string, m: string, p: string) => (
    <>
      {run}
      <Sep />
      <Part on={m.trim() !== ""} mono>
        {m.trim() || "default model"}
      </Part>
      <Sep />
      <Part on={p.trim() !== ""}>{p.trim() ? "custom prompt" : "default prompt"}</Part>
    </>
  );

  const customSummary = `Custom: auto-review ${enabled ? "on" : "off"}, auto-merge ${onOff(autoMerge, globals.auto_merge)}, refine ${onOff(refineEnabled, globals.refine_enabled)}, implement ${onOff(implementEnabled, globals.implement_enabled)}, auto-ready ${onOff(autoReady, globals.auto_ready)}`;

  return (
    <div className="w-full min-w-0 max-w-3xl space-y-7">
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
              {deleteMut.isPending ? "Deleting…" : "Delete repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Let fouine merge PRs on this repo?</DialogTitle>
            <DialogDescription>
              Auto-merge merges PRs fouine approves without human review. You can turn it off
              anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMergeConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={updateMut.isPending}
              onClick={() => {
                setMergeConfirmOpen(false);
                updateMut.mutate();
              }}
            >
              {updateMut.isPending ? "Turning on…" : "Turn on auto-merge"}
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
            <Button variant="outline" onClick={() => cancelNavBlock?.()}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              className="text-red-300 hover:text-red-200"
              onClick={() => proceedNav?.()}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Link
        to="/repos/$owner/$name"
        params={{ owner, name }}
        className="text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
      >
        <ArrowLeft size={14} /> {repo.full_name}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Repository settings</h1>
        <p className="text-sm text-zinc-400 mt-1 min-w-0 break-all font-mono">{repo.full_name}</p>
      </div>

      <form
        id="repo-settings"
        className="space-y-10"
        onInvalidCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>("[data-agent]");
          if (row) openAgent(row.dataset.agent as AgentId);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          requestSave();
        }}
      >
        <Section title="Automation" description="What fouine does on its own for this repo.">
          <fieldset className="space-y-2">
            <legend className="sr-only">Automation level</legend>
            <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {AUTOMATION_LEVELS.map((l) => (
                <label
                  key={l.value}
                  className="flex cursor-pointer gap-3 p-3 has-[:checked]:bg-zinc-800/60"
                >
                  <input
                    type="radio"
                    name="automation"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-ember-500 focus-ring"
                    checked={currentLevel === l.value}
                    onChange={() => {
                      const flags = presetFlags(l.value);
                      setEnabled(flags.enabled === 1);
                      setAutoMerge(flags.auto_merge);
                      setRefineEnabled(flags.refine_enabled);
                      setImplementEnabled(flags.implement_enabled);
                      setAutoReady(flags.auto_ready);
                    }}
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm text-zinc-200">{l.label}</span>
                    <span className="block text-xs text-zinc-500">{l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {currentLevel === "custom" && <p className="text-xs text-zinc-400">{customSummary}</p>}
          </fieldset>

          {mergeMethodActive && (
            <div className="max-w-sm space-y-1.5 pt-2">
              <Label htmlFor="merge_method">Merge method</Label>
              <select
                id="merge_method"
                className={SELECT_CLASS}
                value={mergeMethod ?? "inherit"}
                onChange={(e) =>
                  setMergeMethod(
                    e.target.value === "inherit"
                      ? null
                      : (e.target.value as "merge" | "squash" | "rebase"),
                  )
                }
              >
                <option value="inherit">
                  Use global default (currently {settings?.merge_method ?? "squash"})
                </option>
                <option value="squash">Squash and merge</option>
                <option value="merge">Create a merge commit</option>
                <option value="rebase">Rebase and merge</option>
              </select>
            </div>
          )}
        </Section>

        <Section
          title="Agents"
          description="Models and instructions per agent. Empty fields use the global default."
        >
          <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            <AgentRow
              id="reviewer"
              name="Reviewer"
              open={openAgents.reviewer}
              onToggle={() => toggleAgent("reviewer")}
              edited={reviewerEdited}
              summary={agentSummary(enabled ? "Runs on every PR" : "Off", model, prompt)}
            >
              <div className="space-y-1.5">
                <Label htmlFor="model">Model override</Label>
                <div className="max-w-md">
                  <ModelInput
                    id="model"
                    placeholder="provider/model (leave empty for default)"
                    value={model}
                    onChange={setModel}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt">Review prompt override</Label>
                <Textarea
                  id="prompt"
                  rows={4}
                  className="resize-y"
                  placeholder="Custom review instructions for this repo..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deny_test_commands">
                  Let the reviewer run tests, lint, typecheck, build
                </Label>
                <select
                  id="deny_test_commands"
                  className={SELECT_CLASS}
                  value={denyTestCommands === null ? "inherit" : String(denyTestCommands)}
                  onChange={(e) =>
                    setDenyTestCommands(e.target.value === "inherit" ? null : Number(e.target.value))
                  }
                >
                  <option value="inherit">
                    Use global default (currently{" "}
                    {settings?.deny_test_commands === "1" ? "don't run them" : "run them"})
                  </option>
                  <option value="1">Don't run them on this repo</option>
                  <option value="0">Run them on this repo</option>
                </select>
              </div>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="auto_merge">Auto-merge PRs once fouine approves</Label>
              <select
                id="auto_merge"
                className={SELECT_CLASS}
                value={autoMerge === null ? "inherit" : String(autoMerge)}
                onChange={(e) =>
                  setAutoMerge(e.target.value === "inherit" ? null : Number(e.target.value))
                }
              >
                <option value="inherit">
                  Use global default (currently {settings?.auto_merge === "1" ? "on" : "off"})
                </option>
                <option value="1">On for this repo</option>
                <option value="0">Off for this repo</option>
              </select>
            </div>
            </AgentRow>

            <AgentRow
              id="refiner"
              name="Refiner"
              open={openAgents.refiner}
              onToggle={() => toggleAgent("refiner")}
              edited={refinerEdited}
              summary={agentSummary(
                refineOn ? "Refines new issues" : "On demand only",
                refineModel,
                refinePrompt,
              )}
            >
              <div className="space-y-1.5">
                <Label htmlFor="refine_enabled">Auto-refine issues on open</Label>
                <select
                  id="refine_enabled"
                  className={SELECT_CLASS}
                  value={refineEnabled === null ? "inherit" : String(refineEnabled)}
                  onChange={(e) =>
                    setRefineEnabled(e.target.value === "inherit" ? null : Number(e.target.value))
                  }
                >
                  <option value="inherit">
                    Use global default (currently {settings?.refine_enabled === "1" ? "on" : "off"})
                  </option>
                  <option value="1">On for this repo</option>
                  <option value="0">Off for this repo</option>
                </select>
                <p className="text-xs text-zinc-500">
                  Refines a newly opened issue automatically. Always available on demand via{" "}
                  <span className="font-mono">/fouine refine</span>.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refine_model">Refine model override</Label>
                <div className="max-w-md">
                  <ModelInput
                    id="refine_model"
                    placeholder="provider/model (leave empty to inherit the review model)"
                    value={refineModel}
                    onChange={setRefineModel}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refine_prompt">Refine prompt override</Label>
                <Textarea
                  id="refine_prompt"
                  rows={4}
                  className="resize-y"
                  placeholder="Custom issue-refinement instructions for this repo..."
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                />
              </div>
            </AgentRow>

            <AgentRow
              id="implementer"
              name="Implementer"
              open={openAgents.implementer}
              onToggle={() => toggleAgent("implementer")}
              edited={implementerEdited}
              summary={agentSummary(
                implementOn ? "Implements labelled issues" : "On demand only",
                implementModel,
                implementPrompt,
              )}
            >
              <div className="space-y-1.5">
                <Label htmlFor="implement_enabled">Implement issues when labelled</Label>
                <select
                  id="implement_enabled"
                  className={SELECT_CLASS}
                  value={implementEnabled === null ? "inherit" : String(implementEnabled)}
                  onChange={(e) =>
                    setImplementEnabled(e.target.value === "inherit" ? null : Number(e.target.value))
                  }
                >
                  <option value="inherit">
                    Use global default (currently{" "}
                    {settings?.implement_enabled === "1" ? "on" : "off"})
                  </option>
                  <option value="1">On for this repo</option>
                  <option value="0">Off for this repo</option>
                </select>
                <p className="text-xs text-zinc-500">
                  Implements an issue once it's labelled. Always available on demand via{" "}
                  <span className="font-mono">/fouine implement</span>.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto_ready">Mark issues ready itself</Label>
                <select
                  id="auto_ready"
                  className={SELECT_CLASS}
                  value={autoReady === null ? "inherit" : String(autoReady)}
                  onChange={(e) =>
                    setAutoReady(e.target.value === "inherit" ? null : Number(e.target.value))
                  }
                >
                  <option value="inherit">
                    Use global default (currently {settings?.auto_ready === "1" ? "on" : "off"})
                  </option>
                  <option value="1">On for this repo</option>
                  <option value="0">Off for this repo</option>
                </select>
                <p className="text-xs text-zinc-500">
                  fouine adds the ready label itself when the issue is clear; humans can still add it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="implement_label">Implement label</Label>
                <Input
                  id="implement_label"
                  className="max-w-xs"
                  placeholder="fouine-ready"
                  value={implementLabel}
                  onChange={(e) => setImplementLabel(e.target.value)}
                />
                <p className="text-xs text-zinc-500">
                  Label that triggers the implementer. Empty = inherit the global label.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="implement_model">Implement model override</Label>
                <div className="max-w-md">
                  <ModelInput
                    id="implement_model"
                    placeholder="provider/model (leave empty to inherit the review model)"
                    value={implementModel}
                    onChange={setImplementModel}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="implement_prompt">Implement prompt override</Label>
                <Textarea
                  id="implement_prompt"
                  rows={4}
                  className="resize-y"
                  placeholder="Custom issue-implementation instructions for this repo..."
                  value={implementPrompt}
                  onChange={(e) => setImplementPrompt(e.target.value)}
                />
              </div>
            </AgentRow>
          </div>
        </Section>
      </form>

      <Section title="Danger zone" description="Removes the repository from fouine. Reviews are kept, GitHub is untouched." className="!mt-12">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-red-300 hover:bg-red-950/40 hover:text-red-200"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 size={14} />
          Delete repository
        </Button>
      </Section>

      {dirty && (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-lg md:border">
          <span className="text-sm text-zinc-400">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              Reset
            </Button>
            <Button type="submit" form="repo-settings" size="sm" disabled={updateMut.isPending}>
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
