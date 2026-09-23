import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
import { api, type KeySource, type Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelInput } from "@/components/model-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings.get,
  });

  const [apiKey, setApiKey] = useState("");
  const [zaiApiKey, setZaiApiKey] = useState("");
  const [commandcodeApiKey, setCommandcodeApiKey] = useState("");
  const [model, setModel] = useState("");
  const [refineModel, setRefineModel] = useState("");
  const [implementModel, setImplementModel] = useState("");
  const [improverModel, setImproverModel] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [denyTestCommands, setDenyTestCommands] = useState(false);
  const [refineEnabled, setRefineEnabled] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [autoReady, setAutoReady] = useState(false);
  const [implementEnabled, setImplementEnabled] = useState(false);
  const [implementLabel, setImplementLabel] = useState("");
  const [implementPrompt, setImplementPrompt] = useState("");
  const [autoMerge, setAutoMerge] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">("squash");

  // Baseline to diff against for dirty-tracking; reset on hydrate and on save.
  // apiKey/zaiApiKey/commandcodeApiKey never round-trip from the server (write-only secrets), so
  // they aren't part of the baseline — any non-empty value in them is dirty.
  const [baseline, setBaseline] = useState({
    model: "",
    refineModel: "",
    implementModel: "",
    improverModel: "",
    chatModel: "",
    prompt: "",
    denyTestCommands: false,
    refineEnabled: false,
    refinePrompt: "",
    autoReady: false,
    implementEnabled: false,
    implementLabel: "",
    implementPrompt: "",
    autoMerge: false,
    mergeMethod: "squash" as "merge" | "squash" | "rebase",
  });

  // Hydrate once per fetched settings object, not on every refetch — a ref
  // guard instead of keying a child component, since this page has no natural
  // stable id to key on and the guard is a one-line fix.
  const hydrated = useRef(false);
  useEffect(() => {
    if (settings && !hydrated.current) {
      hydrated.current = true;
      const m = settings.opencode_model ?? "";
      const rm = settings.refine_model ?? "";
      const im = settings.implement_model ?? "";
      const ivm = settings.improver_model ?? "";
      const cm = settings.chat_model ?? "";
      const p = settings.default_prompt ?? "";
      const d = settings.deny_test_commands === "1";
      const re = settings.refine_enabled === "1";
      const rp = settings.default_refine_prompt ?? "";
      const ar = settings.auto_ready === "1";
      const ie = settings.implement_enabled === "1";
      const il = settings.implement_label ?? "";
      const ip = settings.default_implement_prompt ?? "";
      const am = settings.auto_merge === "1";
      const mm = settings.merge_method ?? "squash";
      setModel(m);
      setRefineModel(rm);
      setImplementModel(im);
      setImproverModel(ivm);
      setChatModel(cm);
      setPrompt(p);
      setDenyTestCommands(d);
      setRefineEnabled(re);
      setRefinePrompt(rp);
      setAutoReady(ar);
      setImplementEnabled(ie);
      setImplementLabel(il);
      setImplementPrompt(ip);
      setAutoMerge(am);
      setMergeMethod(mm);
      setBaseline({
        model: m,
        refineModel: rm,
        implementModel: im,
        improverModel: ivm,
        chatModel: cm,
        prompt: p,
        denyTestCommands: d,
        refineEnabled: re,
        refinePrompt: rp,
        autoReady: ar,
        implementEnabled: ie,
        implementLabel: il,
        implementPrompt: ip,
        autoMerge: am,
        mergeMethod: mm,
      });
    }
  }, [settings]);

  const dirty =
    apiKey.trim() !== "" ||
    zaiApiKey.trim() !== "" ||
    commandcodeApiKey.trim() !== "" ||
    model !== baseline.model ||
    refineModel !== baseline.refineModel ||
    implementModel !== baseline.implementModel ||
    improverModel !== baseline.improverModel ||
    chatModel !== baseline.chatModel ||
    prompt !== baseline.prompt ||
    denyTestCommands !== baseline.denyTestCommands ||
    refineEnabled !== baseline.refineEnabled ||
    refinePrompt !== baseline.refinePrompt ||
    autoReady !== baseline.autoReady ||
    implementEnabled !== baseline.implementEnabled ||
    implementLabel !== baseline.implementLabel ||
    implementPrompt !== baseline.implementPrompt ||
    autoMerge !== baseline.autoMerge ||
    mergeMethod !== baseline.mergeMethod;

  const reset = () => {
    setApiKey("");
    setZaiApiKey("");
    setCommandcodeApiKey("");
    setModel(baseline.model);
    setRefineModel(baseline.refineModel);
    setImplementModel(baseline.implementModel);
    setImproverModel(baseline.improverModel);
    setChatModel(baseline.chatModel);
    setPrompt(baseline.prompt);
    setDenyTestCommands(baseline.denyTestCommands);
    setRefineEnabled(baseline.refineEnabled);
    setRefinePrompt(baseline.refinePrompt);
    setAutoReady(baseline.autoReady);
    setImplementEnabled(baseline.implementEnabled);
    setImplementLabel(baseline.implementLabel);
    setImplementPrompt(baseline.implementPrompt);
    setAutoMerge(baseline.autoMerge);
    setMergeMethod(baseline.mergeMethod);
  };

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const { proceed, reset: cancelBlock, status } = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Settings = {};
      if (apiKey.trim()) data.opencode_api_key = apiKey.trim();
      if (zaiApiKey.trim()) data.zai_api_key = zaiApiKey.trim();
      if (commandcodeApiKey.trim()) data.commandcode_api_key = commandcodeApiKey.trim();
      // Models round-trip from the server, so blank means "clear the row" and
      // the cascade takes over (per-repo override → repo review model → the
      // review default) — unlike the secrets above where blank means "keep".
      data.opencode_model = model.trim();
      data.refine_model = refineModel.trim();
      data.implement_model = implementModel.trim();
      data.improver_model = improverModel.trim();
      data.chat_model = chatModel.trim();
      if (prompt.trim()) data.default_prompt = prompt.trim();
      // Empty string deletes the row, i.e. off — so always send it, unlike the
      // text fields above where blank means "keep what's there".
      data.deny_test_commands = denyTestCommands ? "1" : "";
      data.refine_enabled = refineEnabled ? "1" : "";
      if (refinePrompt.trim()) data.default_refine_prompt = refinePrompt.trim();
      data.auto_ready = autoReady ? "1" : "";
      data.implement_enabled = implementEnabled ? "1" : "";
      data.implement_label = implementLabel.trim();
      if (implementPrompt.trim()) data.default_implement_prompt = implementPrompt.trim();
      data.auto_merge = autoMerge ? "1" : "";
      data.merge_method = mergeMethod;
      return api.settings.update(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setApiKey("");
      setZaiApiKey("");
      setCommandcodeApiKey("");
      setBaseline({
        model,
        refineModel,
        implementModel,
        improverModel,
        chatModel,
        prompt,
        denyTestCommands,
        refineEnabled,
        refinePrompt,
        autoReady,
        implementEnabled,
        implementLabel,
        implementPrompt,
        autoMerge,
        mergeMethod,
      });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error("Couldn't save settings", { description: e.message }),
  });

  return (
    <div className="mx-auto space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Dialog open={status === "blocked"} onOpenChange={(open) => !open && cancelBlock?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved settings. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => cancelBlock?.()}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => proceed?.()}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMut.mutate();
        }}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <p className="text-sm text-zinc-500">
              One model per agent. A repo can override all but the improver on its own page.
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-800">
              <AgentRow id="model" name="Reviewer" description="Reviews pull requests">
                <ModelInput
                  id="model"
                  placeholder="opencode-go/deepseek-v4-flash"
                  value={model}
                  onChange={setModel}
                />
                <p className="text-xs text-zinc-500">
                  A repo's model override wins — set it on the repo's page.
                </p>
              </AgentRow>
              <AgentRow
                id="refine_model"
                name="Refiner"
                description="Turns new issues into clear specs (/fouine refine)"
              >
                <ModelInput
                  id="refine_model"
                  placeholder="provider/model"
                  value={refineModel}
                  onChange={setRefineModel}
                />
                <p className="text-xs text-zinc-500">
                  Repo overrides win; empty = each repo's review model.
                </p>
              </AgentRow>
              <AgentRow
                id="implement_model"
                name="Implementer"
                description="Implements labelled issues (/fouine implement)"
              >
                <ModelInput
                  id="implement_model"
                  placeholder="provider/model"
                  value={implementModel}
                  onChange={setImplementModel}
                />
                <p className="text-xs text-zinc-500">
                  Repo overrides win; empty = each repo's review model.
                </p>
              </AgentRow>
              <AgentRow
                id="improver_model"
                name="Improver"
                description="Refreshes REVIEW.md daily"
              >
                <ModelInput
                  id="improver_model"
                  placeholder="provider/model"
                  value={improverModel}
                  onChange={setImproverModel}
                />
                <p className="text-xs text-zinc-500">
                  Global only — runs rarely but shapes every future review, so it's worth a
                  stronger model than the reviewer.
                </p>
              </AgentRow>
              <AgentRow
                id="chat_model"
                name="Chat"
                description="Answers questions and composes /build dashboards"
              >
                <ModelInput
                  id="chat_model"
                  placeholder="provider/model"
                  value={chatModel}
                  onChange={setChatModel}
                />
                <p className="text-xs text-zinc-500">
                  Global only; empty = <code>OPENCODE_CHAT_MODEL</code>, then the repo default.
                  Independent of the review model. Needs an OpenAI-compatible model.
                </p>
              </AgentRow>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provider keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <ProviderKeyField
                id="api_key"
                label="API key"
                placeholder="Set key to enable reviews"
                value={apiKey}
                onChange={setApiKey}
                settingKey="opencode_api_key"
                source={settings?.opencode_key_source}
                envVar="OPENCODE_API_KEY"
                testProvider="opencode"
                helpText="Used for every provider except the two below."
                queryClient={queryClient}
              />
              <ProviderKeyField
                id="zai_api_key"
                label="GLM Coding Plan API key"
                placeholder="Z.ai key — used for zai-coding-plan/* models"
                value={zaiApiKey}
                onChange={setZaiApiKey}
                settingKey="zai_api_key"
                source={settings?.zai_key_source}
                envVar="ZAI_API_KEY"
                testProvider="zai"
                helpText="Only used when a model spec starts with zai-coding-plan/."
                queryClient={queryClient}
              />
              <ProviderKeyField
                id="commandcode_api_key"
                label="Command Code API key"
                placeholder="commandcode.ai key — used for commandcode/* models"
                value={commandcodeApiKey}
                onChange={setCommandcodeApiKey}
                settingKey="commandcode_api_key"
                source={settings?.commandcode_key_source}
                envVar="COMMANDCODE_API_KEY"
                testProvider="commandcode"
                helpText="Only used when a model spec starts with commandcode/."
                queryClient={queryClient}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
            <p className="text-sm text-zinc-500">Defaults for every repo; a repo can override.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  id="deny_test_commands"
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-200"
                  checked={denyTestCommands}
                  onChange={(e) => setDenyTestCommands(e.target.checked)}
                />
                Don't run tests, linter, typechecker or build during a review
              </label>
              <p className="text-xs text-zinc-500">
                CI already runs them, and the review worktree has no env vars — so they tend to
                fail for unrelated reasons and show up as findings.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt">Default review prompt</Label>
              <Textarea
                id="prompt"
                rows={10}
                placeholder="Reviewer instructions applied when a repo has no override..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issues</CardTitle>
            <p className="text-sm text-zinc-500">Refiner and implementer defaults, per repo.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  id="refine_enabled"
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-200"
                  checked={refineEnabled}
                  onChange={(e) => setRefineEnabled(e.target.checked)}
                />
                Refine issues automatically when opened
              </label>
              <p className="text-xs text-zinc-500">
                Always available on demand via <span className="font-mono">/fouine refine</span>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default_refine_prompt">Default refine prompt</Label>
              <Textarea
                id="default_refine_prompt"
                rows={10}
                placeholder="Refiner instructions applied when a repo has no override..."
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  id="auto_ready"
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-200"
                  checked={autoReady}
                  onChange={(e) => setAutoReady(e.target.checked)}
                />
                Refiner marks issues ready
              </label>
              <p className="text-xs text-zinc-500">
                fouine adds the ready label itself when the issue is clear; humans can still add it.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  id="implement_enabled"
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-200"
                  checked={implementEnabled}
                  onChange={(e) => setImplementEnabled(e.target.checked)}
                />
                Implement issues automatically when labelled
              </label>
              <p className="text-xs text-zinc-500">
                Always available on demand via{" "}
                <span className="font-mono">/fouine implement</span>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="implement_label">Implement label</Label>
              <Input
                id="implement_label"
                placeholder="fouine-ready"
                value={implementLabel}
                onChange={(e) => setImplementLabel(e.target.value)}
              />
              <p className="text-xs text-zinc-500">Label that triggers the implementer.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="default_implement_prompt">Default implement prompt</Label>
              <Textarea
                id="default_implement_prompt"
                rows={10}
                placeholder="Implementer instructions applied when a repo has no override..."
                value={implementPrompt}
                onChange={(e) => setImplementPrompt(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Merging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
                <input
                  id="auto_merge"
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-200"
                  checked={autoMerge}
                  onChange={(e) => setAutoMerge(e.target.checked)}
                />
                Auto-merge PRs once fouine approves
              </label>
              <p className="text-xs text-zinc-500">
                Merges automatically once fouine approved, CI is green, and no human requested
                changes. A new push re-arms it on the new commit; draft PRs are skipped.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="merge_method">Merge method</Label>
              <select
                id="merge_method"
                className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                value={mergeMethod}
                onChange={(e) => setMergeMethod(e.target.value as "merge" | "squash" | "rebase")}
              >
                <option value="squash">Squash and merge</option>
                <option value="merge">Create a merge commit</option>
                <option value="rebase">Rebase and merge</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!dirty || updateMut.isPending}>
            Save settings
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          )}
        </div>
      </form>

      <SkillsCard />
    </div>
  );
}

// One provider's key field: the input, its source badge ("using dashboard
// key" / "using env var X" / "not set"), a "Remove, use env" action while a
// dashboard row shadows the env var, and that provider's own Test button.
// Each field pushes its own key server-side (task B's ensureProviderKey) and
// runs a real prompt through a model that provider actually serves, so
// "Test" reports the real state instead of the old single button that only
// ever exercised the default model's provider.
function ProviderKeyField({
  id,
  label,
  placeholder,
  value,
  onChange,
  settingKey,
  source,
  envVar,
  testProvider,
  helpText,
  queryClient,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  settingKey: "opencode_api_key" | "zai_api_key" | "commandcode_api_key";
  source: KeySource | undefined;
  envVar: string;
  testProvider: "opencode" | "zai" | "commandcode";
  helpText: string;
  queryClient: QueryClient;
}) {
  const testMut = useMutation({
    mutationFn: () => api.settings.test(testProvider),
    onError: (e: Error) => toast.error(`Couldn't test ${label}`, { description: e.message }),
  });
  const removeMut = useMutation({
    mutationFn: () => api.settings.update({ [settingKey]: "" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Key removed — falling back to the env var");
    },
    onError: (e: Error) => toast.error("Couldn't remove key", { description: e.message }),
  });

  // A saved/removed key changes what the next test would exercise — drop the
  // stale result rather than show a green "OK" for a key that's gone.
  const lastSource = useRef(source);
  useEffect(() => {
    if (lastSource.current !== source) {
      lastSource.current = source;
      testMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const hasKey = source === "dashboard" || source === "env";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-zinc-500">{helpText} Leave blank to keep the current value.</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {source === "dashboard" && (
          <>
            <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">
              Using dashboard key (overrides env)
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removeMut.isPending}
              onClick={() => removeMut.mutate()}
            >
              {removeMut.isPending ? "Removing…" : "Remove, use env"}
            </Button>
          </>
        )}
        {source === "env" && (
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">
            Using env var {envVar}
          </span>
        )}
        {source === "none" && (
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-500">
            Not set
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasKey || testMut.isPending}
          onClick={() => {
            testMut.reset();
            testMut.mutate();
          }}
        >
          {testMut.isPending ? "Testing…" : "Test connection"}
        </Button>
      </div>
      {testMut.data && (
        <p
          className={`text-xs font-mono ${testMut.data.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {testMut.data.ok
            ? `OK (${testMut.data.model ?? ""}) — replied: ${testMut.data.text ?? ""}`
            : `Failed (${testMut.data.model ?? ""}): ${testMut.data.error ?? "unknown error"}`}
        </p>
      )}
    </div>
  );
}

// One row of the Models card: agent name + role on the left, its model control
// on the right. Stacks on narrow screens.
function AgentRow({
  id,
  name,
  description,
  children,
}: {
  id: string;
  name: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{name}</Label>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

// Global reviewer skills, installed from a skills.sh / GitHub URL. They apply to
// every review; per-repo skills belong in the repo's own .claude/skills instead.
function SkillsCard() {
  const queryClient = useQueryClient();
  const { data: skills } = useQuery({ queryKey: ["skills"], queryFn: api.skills.list });
  const [url, setUrl] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["skills"] });

  const installMut = useMutation({
    mutationFn: () => api.skills.install(url.trim()),
    onSuccess: () => {
      invalidate();
      setUrl("");
    },
    onError: (e: Error) => toast.error("Couldn't install skill", { description: e.message }),
  });
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.skills.setEnabled(name, enabled),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Couldn't update skill", { description: e.message }),
  });
  const removeMut = useMutation({
    mutationFn: (name: string) => api.skills.remove(name),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Couldn't remove skill", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviewer skills</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) installMut.mutate();
          }}
          className="space-y-1.5"
        >
          <Label htmlFor="skill_url">Install a skill</Label>
          <div className="flex gap-2">
            <Input
              id="skill_url"
              placeholder="https://skills.sh/owner/repo/skill or a github.com URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" disabled={installMut.isPending || !url.trim()}>
              {installMut.isPending ? "Installing…" : "Install"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Global — applies to every review, live on the next one. For a single repo, commit a{" "}
            <code>.claude/skills/</code> folder to that repo instead.
          </p>
          {installMut.isError && (
            <p className="text-xs text-red-400">{String(installMut.error)}</p>
          )}
        </form>

        <div className="divide-y divide-zinc-800 border-t border-zinc-800">
          {skills?.length === 0 && (
            <p className="py-3 text-xs text-zinc-500">No skills installed yet.</p>
          )}
          {skills?.map((s) => (
            <div key={s.name} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <span className="font-mono text-sm">{s.name}</span>
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    {s.owner}/{s.repo}@{s.ref.slice(0, 7)}
                  </a>
                </div>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{s.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={toggleMut.isPending}
                  onClick={() => toggleMut.mutate({ name: s.name, enabled: !s.enabled })}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(s.name)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
