import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
import { api, type KeySource, type Settings } from "@/lib/api";
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
import { ChevronRight, CircleAlert } from "lucide-react";

const SELECT_CLASS =
  "flex h-9 w-full min-w-0 max-w-sm rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm shadow-sm transition-colors focus-ring disabled:opacity-50";
// Dark color-scheme so an unchecked box is a dark well, not a white square.
const CHECKBOX_CLASS = "mt-0.5 h-4 w-4 shrink-0 accent-ember-500 [color-scheme:dark] focus-ring";

// Same section shape as the repo settings page: a heading and one line of
// context over the controls, no card chrome.
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      <div className="mt-3 min-w-0 space-y-4">{children}</div>
    </section>
  );
}

// Set values read brighter than fallbacks; ember stays out of it.
function Part({ on, mono, children }: { on: boolean; mono?: boolean; children: ReactNode }) {
  return (
    <span className={`${on ? "text-zinc-100" : "text-zinc-500"} ${mono && on ? "font-mono" : ""}`}>
      {children}
    </span>
  );
}

function Sep() {
  return <span className="text-zinc-600"> · </span>;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isError, refetch } = useQuery({
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
      data.default_prompt = prompt.trim();
      // Empty string deletes the row, i.e. off — so always send it, unlike the
      // text fields above where blank means "keep what's there".
      data.deny_test_commands = denyTestCommands ? "1" : "";
      data.refine_enabled = refineEnabled ? "1" : "";
      // Prompts round-trip like models: blank deletes the row and the built-in
      // prompt takes over. Safe because the form only renders once hydrated.
      data.default_refine_prompt = refinePrompt.trim();
      data.auto_ready = autoReady ? "1" : "";
      data.implement_enabled = implementEnabled ? "1" : "";
      data.implement_label = implementLabel.trim();
      data.default_implement_prompt = implementPrompt.trim();
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


  const [openAgents, setOpenAgents] = useState({
    reviewer: false,
    refiner: false,
    implementer: false,
    improver: false,
    chat: false,
  });
  const toggleAgent = (id: keyof typeof openAgents) =>
    setOpenAgents((o) => ({ ...o, [id]: !o[id] }));

  // Editing before hydration would save blanks over every model, so the form
  // only renders once the real values are in.
  if (isError && !settings) {
    return (
      <div className="w-full min-w-0 max-w-3xl space-y-7">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 py-16 text-center">
          <CircleAlert size={28} className="text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-400">Couldn't load settings</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="w-full min-w-0 max-w-3xl space-y-7">
        <div className="h-8 w-40 rounded bg-zinc-900/60 animate-pulse" />
        <div className="h-48 rounded-lg bg-zinc-900/60 animate-pulse" />
        <div className="h-64 rounded-lg bg-zinc-900/60 animate-pulse" />
      </div>
    );
  }

  const reviewerEdited =
    model !== baseline.model ||
    prompt !== baseline.prompt ||
    denyTestCommands !== baseline.denyTestCommands;
  const refinerEdited =
    refineModel !== baseline.refineModel || refinePrompt !== baseline.refinePrompt;
  const implementerEdited =
    implementModel !== baseline.implementModel ||
    implementLabel !== baseline.implementLabel ||
    implementPrompt !== baseline.implementPrompt;

  return (
    <div className="w-full min-w-0 max-w-3xl space-y-7">
      <Dialog open={status === "blocked"} onOpenChange={(open) => !open && cancelBlock?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved settings. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => cancelBlock?.()}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              className="text-red-300 hover:text-red-200"
              onClick={() => proceed?.()}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Defaults for every repo. A repo can override most of them on its own settings page.
        </p>
      </div>

      <form
        id="settings"
        className="space-y-10"
        onSubmit={(e) => {
          e.preventDefault();
          updateMut.mutate();
        }}
      >
        <Section
          title="Provider keys"
          description="Keys saved here override the env vars. Leave a field blank to keep the current key."
        >
          <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            <ProviderKeyField
              id="api_key"
              label="API key"
              placeholder="Set key to enable reviews"
              value={apiKey}
              onChange={setApiKey}
              settingKey="opencode_api_key"
              source={settings.opencode_key_source}
              envVar="OPENCODE_API_KEY"
              testProvider="opencode"
              helpText="Used for every provider except the two below."
            />
            <ProviderKeyField
              id="zai_api_key"
              label="GLM Coding Plan API key"
              placeholder="Z.ai key"
              value={zaiApiKey}
              onChange={setZaiApiKey}
              settingKey="zai_api_key"
              source={settings.zai_key_source}
              envVar="ZAI_API_KEY"
              testProvider="zai"
              helpText={
                <>
                  Only used for <span className="font-mono">zai-coding-plan/*</span> models.
                </>
              }
            />
            <ProviderKeyField
              id="commandcode_api_key"
              label="Command Code API key"
              placeholder="commandcode.ai key"
              value={commandcodeApiKey}
              onChange={setCommandcodeApiKey}
              settingKey="commandcode_api_key"
              source={settings.commandcode_key_source}
              envVar="COMMANDCODE_API_KEY"
              testProvider="commandcode"
              helpText={
                <>
                  Only used for <span className="font-mono">commandcode/*</span> models.
                </>
              }
            />
          </div>
        </Section>

        <Section
          title="Automation"
          description="What fouine does on its own, on every repo that doesn't override it."
        >
          <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            <Toggle
              id="auto_merge"
              label="Auto-merge PRs once fouine approves"
              hint="Once fouine approved, CI is green and no human requested changes. A new push re-arms it on the new commit; draft PRs are skipped."
              checked={autoMerge}
              onChange={setAutoMerge}
            />
            <Toggle
              id="refine_enabled"
              label="Refine issues automatically when opened"
              hint={
                <>
                  Always available on demand via <span className="font-mono">/fouine refine</span>.
                </>
              }
              checked={refineEnabled}
              onChange={setRefineEnabled}
            />
            <Toggle
              id="auto_ready"
              label="Refiner marks issues ready"
              hint="fouine adds the ready label itself when the issue is clear; humans can still add it."
              checked={autoReady}
              onChange={setAutoReady}
            />
            <Toggle
              id="implement_enabled"
              label="Implement issues automatically when labelled"
              hint={
                <>
                  Always available on demand via{" "}
                  <span className="font-mono">/fouine implement</span>.
                </>
              }
              checked={implementEnabled}
              onChange={setImplementEnabled}
            />
          </div>
          {/* Always shown, unlike the repo page: a repo that turns auto-merge on
              for itself inherits this method even while the global switch is off. */}
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="merge_method">Merge method</Label>
            <select
              id="merge_method"
              className={SELECT_CLASS}
              value={mergeMethod}
              onChange={(e) => setMergeMethod(e.target.value as "merge" | "squash" | "rebase")}
            >
              <option value="squash">Squash and merge</option>
              <option value="merge">Create a merge commit</option>
              <option value="rebase">Rebase and merge</option>
            </select>
            <p className="text-xs text-zinc-500">
              Used whenever auto-merge is on, here or on a repo.
            </p>
          </div>
        </Section>

        <Section
          title="Agents"
          description="Model and instructions per agent. A repo can override the reviewer, refiner and implementer."
        >
          <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            <AgentRow
              id="reviewer"
              name="Reviewer"
              open={openAgents.reviewer}
              onToggle={() => toggleAgent("reviewer")}
              edited={reviewerEdited}
              summary={
                <>
                  <Part on={model.trim() !== ""} mono>
                    {model.trim() || "default model"}
                  </Part>
                  <Sep />
                  <Part on={prompt.trim() !== ""}>
                    {prompt.trim() ? "custom prompt" : "built-in prompt"}
                  </Part>
                  <Sep />
                  <Part on={denyTestCommands}>
                    {denyTestCommands ? "skips tests" : "may run tests"}
                  </Part>
                </>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="model">Model</Label>
                <div className="max-w-md space-y-1.5">
                  <ModelInput
                    id="model"
                    placeholder="opencode-go/deepseek-v4-flash"
                    value={model}
                    onChange={setModel}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt">Default review prompt</Label>
                <Textarea
                  id="prompt"
                  rows={6}
                  className="resize-y"
                  placeholder="Reviewer instructions applied when a repo has no override..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <label className="flex cursor-pointer gap-3">
                <input
                  id="deny_test_commands"
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  aria-labelledby="deny_test_commands-label"
                  aria-describedby="deny_test_commands-hint"
                  checked={denyTestCommands}
                  onChange={(e) => setDenyTestCommands(e.target.checked)}
                />
                <span className="min-w-0 space-y-0.5">
                  <span id="deny_test_commands-label" className="block text-sm text-zinc-200">
                    Don't run tests, linter, typechecker or build during a review
                  </span>
                  <span id="deny_test_commands-hint" className="block text-xs text-zinc-500">
                    CI already runs them, and the review worktree has no env vars, so they tend to
                    fail for unrelated reasons and show up as findings.
                  </span>
                </span>
              </label>
            </AgentRow>

            <AgentRow
              id="refiner"
              name="Refiner"
              open={openAgents.refiner}
              onToggle={() => toggleAgent("refiner")}
              edited={refinerEdited}
              summary={
                <>
                  <Part on={refineModel.trim() !== ""} mono>
                    {refineModel.trim() || "review model"}
                  </Part>
                  <Sep />
                  <Part on={refinePrompt.trim() !== ""}>
                    {refinePrompt.trim() ? "custom prompt" : "built-in prompt"}
                  </Part>
                </>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="refine_model">Model</Label>
                <div className="max-w-md space-y-1.5">
                  <ModelInput
                    id="refine_model"
                    placeholder="provider/model"
                    value={refineModel}
                    onChange={setRefineModel}
                  />
                </div>
                <p className="text-xs text-zinc-500">Empty = each repo's review model.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default_refine_prompt">Default refine prompt</Label>
                <Textarea
                  id="default_refine_prompt"
                  rows={6}
                  className="resize-y"
                  placeholder="Refiner instructions applied when a repo has no override..."
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
              summary={
                <>
                  <Part on={implementModel.trim() !== ""} mono>
                    {implementModel.trim() || "review model"}
                  </Part>
                  <Sep />
                  <Part on={implementLabel.trim() !== ""} mono>
                    {implementLabel.trim() ? `label ${implementLabel.trim()}` : "default label"}
                  </Part>
                  <Sep />
                  <Part on={implementPrompt.trim() !== ""}>
                    {implementPrompt.trim() ? "custom prompt" : "built-in prompt"}
                  </Part>
                </>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="implement_model">Model</Label>
                <div className="max-w-md space-y-1.5">
                  <ModelInput
                    id="implement_model"
                    placeholder="provider/model"
                    value={implementModel}
                    onChange={setImplementModel}
                  />
                </div>
                <p className="text-xs text-zinc-500">Empty = each repo's review model.</p>
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
                <p className="text-xs text-zinc-500">Label that triggers the implementer.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default_implement_prompt">Default implement prompt</Label>
                <Textarea
                  id="default_implement_prompt"
                  rows={6}
                  className="resize-y"
                  placeholder="Implementer instructions applied when a repo has no override..."
                  value={implementPrompt}
                  onChange={(e) => setImplementPrompt(e.target.value)}
                />
              </div>
            </AgentRow>

            <AgentRow
              id="improver"
              name="Improver"
              open={openAgents.improver}
              onToggle={() => toggleAgent("improver")}
              edited={improverModel !== baseline.improverModel}
              summary={
                <>
                  Refreshes REVIEW.md daily
                  <Sep />
                  <Part on={improverModel.trim() !== ""} mono>
                    {improverModel.trim() || "review model"}
                  </Part>
                </>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="improver_model">Model</Label>
                <div className="max-w-md space-y-1.5">
                  <ModelInput
                    id="improver_model"
                    placeholder="provider/model"
                    value={improverModel}
                    onChange={setImproverModel}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Global only. It runs rarely but shapes every future review, so it's worth a
                  stronger model than the reviewer. Empty = the review model.
                </p>
              </div>
            </AgentRow>

            <AgentRow
              id="chat"
              name="Chat"
              open={openAgents.chat}
              onToggle={() => toggleAgent("chat")}
              edited={chatModel !== baseline.chatModel}
              summary={
                <>
                  Answers questions, composes /build dashboards
                  <Sep />
                  <Part on={chatModel.trim() !== ""} mono>
                    {chatModel.trim() || "env default"}
                  </Part>
                </>
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="chat_model">Model</Label>
                <div className="max-w-md space-y-1.5">
                  <ModelInput
                    id="chat_model"
                    placeholder="provider/model"
                    value={chatModel}
                    onChange={setChatModel}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Global only, and independent of the review model. Must be OpenAI-compatible.
                  Empty = <span className="font-mono">OPENCODE_CHAT_MODEL</span>, then the repo
                  default.
                </p>
              </div>
            </AgentRow>
          </div>
        </Section>
      </form>

      <SkillsSection />

      {dirty && (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-lg md:border">
          <span className="text-sm text-zinc-400">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
            <Button type="submit" form="settings" size="sm" disabled={updateMut.isPending}>
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// One on/off row inside a bordered list, label and hint beside the checkbox.
function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/60">
      <input
        id={id}
        type="checkbox"
        className={CHECKBOX_CLASS}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 space-y-0.5">
        <span id={`${id}-label`} className="block text-sm text-zinc-200">
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-xs text-zinc-500">
          {hint}
        </span>
      </span>
    </label>
  );
}

function KeyStatus({ source, envVar }: { source: KeySource | undefined; envVar: string }) {
  if (source === "dashboard")
    return <span className="text-xs text-zinc-300">Dashboard key, overrides env</span>;
  if (source === "env")
    return (
      <span className="text-xs text-zinc-300">
        From <span className="font-mono">{envVar}</span>
      </span>
    );
  return <span className="text-xs text-zinc-500">Not set</span>;
}

// One provider's key field: the input, where the current key comes from
// (dashboard / env var / not set), a "Use env var" action while a dashboard
// row shadows the env var, and that provider's own Test button.
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
  helpText: ReactNode;
}) {
  const queryClient = useQueryClient();
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
  }, [source]);

  const hasKey = source === "dashboard" || source === "env";

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Label htmlFor={id}>{label}</Label>
          <KeyStatus source={source} envVar={envVar} />
        </div>
        <div className="flex items-center gap-1">
          {source === "dashboard" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removeMut.isPending}
              onClick={() => removeMut.mutate()}
            >
              {removeMut.isPending ? "Removing…" : "Remove, use env"}
            </Button>
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
            {testMut.isPending ? "Testing…" : "Test"}
          </Button>
        </div>
      </div>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        className="max-w-md"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-zinc-500">{helpText}</p>
      {testMut.data && (
        <p
          className={`break-words text-xs font-mono ${testMut.data.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {testMut.data.ok
            ? `OK (${testMut.data.model ?? ""}) — replied: ${testMut.data.text ?? ""}`
            : `Failed (${testMut.data.model ?? ""}): ${testMut.data.error ?? "unknown error"}`}
        </p>
      )}
    </div>
  );
}

// One inline disclosure row inside the Agents list, same shape as the repo
// settings page. The body stays mounted (just hidden) so field ids keep working.
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
    <div>
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
          <span className="block break-words text-xs text-zinc-500">{summary}</span>
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

// Global reviewer skills, installed from a skills.sh / GitHub URL. They apply to
// every review; per-repo skills belong in the repo's own .claude/skills instead.
function SkillsSection() {
  const queryClient = useQueryClient();
  const { data: skills, isError, refetch } = useQuery({
    queryKey: ["skills"],
    queryFn: api.skills.list,
  });
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
    <Section
      title="Reviewer skills"
      description={
        <>
          Apply to every review, live on the next one. For a single repo, commit a{" "}
          <span className="font-mono">.claude/skills/</span> folder to that repo instead.
        </>
      }
    >
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
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="skills.sh or github.com URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            className="shrink-0"
            disabled={installMut.isPending || !url.trim()}
          >
            {installMut.isPending ? "Installing…" : "Install"}
          </Button>
        </div>
        {installMut.isError && (
          <p className="text-xs text-red-400">{String(installMut.error)}</p>
        )}
      </form>

      {isError && !skills ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-zinc-800 px-4 py-3">
          <span className="text-sm text-zinc-400">Couldn't load skills</span>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : !skills ? (
        <div className="h-14 rounded-md bg-zinc-900/60 animate-pulse" />
      ) : skills.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
          No skills installed. Paste a skill's URL above to add one.
        </p>
      ) : (
        <div className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {skills.map((s) => (
            <div
              key={s.name}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <span className="truncate font-mono text-sm text-zinc-100">{s.name}</span>
                  {!s.enabled && <span className="shrink-0 text-xs text-zinc-500">disabled</span>}
                </div>
                <a
                  href={s.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate pl-3.5 font-mono text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {s.owner}/{s.repo}@{s.ref.slice(0, 7)}
                </a>
                {s.description && (
                  <p className="mt-1 line-clamp-2 pl-3.5 text-xs text-zinc-400">{s.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 pl-2.5 sm:pl-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={toggleMut.isPending}
                  onClick={() => toggleMut.mutate({ name: s.name, enabled: !s.enabled })}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-300 hover:bg-red-950/40 hover:text-red-200"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(s.name)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
