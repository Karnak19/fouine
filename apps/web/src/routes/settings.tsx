import { useState, useEffect } from "react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { color, font, leading, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";
import { api, type Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelInput } from "@/components/model-input";

const s = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x768 },
  h1: { fontSize: text.xl2, lineHeight: leading.xl2, fontWeight: 700 },
  // `space-y-4`, same story as `field` below: the submit <button> is
  // inline-block, and a column flex would blockify it to full width. Block
  // container; the 16px lives on `field`, which is every child but the last.
  stack4: { display: "block" },
  // Tailwind's `space-y-1.5` was `margin-bottom` on every child but the last,
  // NOT a column flex with a gap: a flex item is blockified, which turns the
  // inline <label> into a full-width block sized by `line-height: 1` instead
  // of by font metrics (49x17 -> 718x14, and 4px lost per field). So the
  // container stays a plain block and each 6px gap is carried by the element
  // BELOW it (`spaced`) — margin on the inline label is ignored either way,
  // which is what main did too.
  field: { display: "block", marginBottom: space.x16 },
  spaced: { marginTop: space.x6 },
  hint: { fontSize: text.xs, lineHeight: leading.xs, color: color.zinc500 },
  error: { fontSize: text.xs, lineHeight: leading.xs, color: color.dangerDot },

  // Composed onto `shared.row`; only the extras live here.
  checkboxLabel: {
    fontSize: text.sm,
    lineHeight: leading.sm,
    color: color.zinc300,
    userSelect: "none"
  },
  checkbox: { accentColor: color.zinc200 },

  testBlock: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: color.zinc800,
    paddingTop: space.x16
  },
  testResult: {
    marginTop: space.x8,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontFamily: font.mono
  },
  ok: { color: color.okDot },
  fail: { color: color.dangerDot },

  installRow: { display: "flex", gap: space.x8 },
  // `divide-y` was `border-top` on every child but the first, and the
  // container's own `border-t` drew the line above the first — hence the
  // index guard below rather than a border on every row.
  list: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: color.zinc800 },
  divider: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: color.zinc800 },
  emptyList: {
    paddingBlock: space.x12,
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc500
  },
  skillRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.x12,
    paddingBlock: space.x12
  },
  skillMain: { minWidth: 0 },
  dotOn: { backgroundColor: color.okDot },
  dotOff: { backgroundColor: color.zinc600 },
  skillName: { fontFamily: font.mono, fontSize: text.sm, lineHeight: leading.sm },
  sourceLink: { fontSize: text.xs, lineHeight: leading.xs },
  description: {
    marginTop: space.x4,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    fontSize: text.xs,
    lineHeight: leading.xs,
    color: color.zinc400
  },
  actions: { flexShrink: 0 }
});

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings.get
  });

  const [apiKey, setApiKey] = useState("");
  const [zaiApiKey, setZaiApiKey] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [improverModel, setImproverModel] = useState("");
  const [denyTestCommands, setDenyTestCommands] = useState(false);

  useEffect(() => {
    if (settings) {
      setModel(settings.opencode_model ?? "");
      setPrompt(settings.default_prompt ?? "");
      setImproverModel(settings.improver_model ?? "");
      setDenyTestCommands(settings.deny_test_commands === "1");
    }
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Settings = {};
      if (apiKey.trim()) data.opencode_api_key = apiKey.trim();
      if (zaiApiKey.trim()) data.zai_api_key = zaiApiKey.trim();
      if (model.trim()) data.opencode_model = model.trim();
      if (prompt.trim()) data.default_prompt = prompt.trim();
      if (improverModel.trim()) data.improver_model = improverModel.trim();
      // Empty string deletes the row, i.e. off — so always send it, unlike the
      // text fields above where blank means "keep what's there".
      data.deny_test_commands = denyTestCommands ? "1" : "";
      return api.settings.update(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setApiKey("");
      setZaiApiKey("");
    }
  });

  const testMut = useMutation({
    mutationFn: api.settings.test
  });

  return (
    <div {...stylex.props(s.page)}>
      <h1 {...stylex.props(s.h1)}>Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>OpenCode provider</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMut.mutate();
            }}
            {...stylex.props(s.stack4)}
          >
            <div {...stylex.props(s.field)}>
              <Label htmlFor="api_key">API key</Label>
              <Input
                id="api_key"
                type="password"
                placeholder="Set key to enable reviews"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p {...stylex.props(s.hint, s.spaced)}>Leave blank to keep current value.</p>
            </div>
            <div {...stylex.props(s.field)}>
              <Label htmlFor="zai_api_key">GLM Coding Plan API key</Label>
              <Input
                id="zai_api_key"
                type="password"
                placeholder="Z.ai key — used for zai-coding-plan/* models"
                value={zaiApiKey}
                onChange={(e) => setZaiApiKey(e.target.value)}
              />
              <p {...stylex.props(s.hint, s.spaced)}>
                Only used when a model spec starts with <code>zai-coding-plan/</code>. When unset,
                opencode uses whatever credential it already has for that provider.
              </p>
            </div>
            <div {...stylex.props(s.field)}>
              <Label htmlFor="model">Default model</Label>
              <ModelInput
                id="model"
                placeholder="opencode-go/deepseek-v4-flash"
                value={model}
                onChange={setModel}
              />
              {/* The opencode-go gateway is not uniformly OpenAI-shaped, and
                  the two consumers differ: reviews go through the opencode
                  server, which picks the right adapter itself, while Chat talks
                  to the gateway directly over @ai-sdk/openai-compatible. A model
                  needing the Anthropic shape reviews fine and breaks Chat with
                  an unhelpful upstream error, so say so here rather than
                  letting it be discovered at request time. */}
              <p {...stylex.props(s.hint, s.spaced)}>
                Used for reviews. Chat has its own model, set only via{" "}
                <code>OPENCODE_CHAT_MODEL</code> — it needs an OpenAI-compatible model, and a few
                opencode-go models use the Anthropic API shape and will work for reviews but fail
                in Chat.
              </p>
            </div>
            <div {...stylex.props(s.field)}>
              <Label htmlFor="improver_model">Improver model</Label>
              <ModelInput
                id="improver_model"
                placeholder="e.g. opencode-go/deepseek-v4-flash — defaults to the review model"
                value={improverModel}
                onChange={setImproverModel}
              />
              <p {...stylex.props(s.hint, s.spaced)}>
                Used by the daily REVIEW.md improver. It runs rarely but its output shapes every
                future review — worth a stronger model than the reviewer.
              </p>
            </div>
            <div {...stylex.props(s.field)}>
              <label {...stylex.props(shared.row, s.checkboxLabel)}>
                <input
                  id="deny_test_commands"
                  type="checkbox"
                  {...stylex.props(shared.icon, s.checkbox)}
                  checked={denyTestCommands}
                  onChange={(e) => setDenyTestCommands(e.target.checked)}
                />
                Don't run tests, linter, typechecker or build during a review
              </label>
              <p {...stylex.props(s.hint, s.spaced)}>
                Default for every repo. CI already runs them, and the review worktree has no env
                vars — so they tend to fail for unrelated reasons and show up as findings. A repo
                can override this.
              </p>
            </div>
            <div {...stylex.props(s.field)}>
              <Label htmlFor="prompt">Default review prompt</Label>
              <Textarea
                id="prompt"
                rows={10}
                placeholder="Reviewer instructions applied when a repo has no override..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={updateMut.isPending}>
              Save settings
            </Button>
          </form>
          <div {...stylex.props(s.testBlock)}>
            <div {...stylex.props(shared.row)}>
              <Button
                type="button"
                variant="outline"
                disabled={testMut.isPending}
                onClick={() => {
                  testMut.reset();
                  testMut.mutate();
                }}
              >
                {testMut.isPending ? "Testing…" : "Test connection"}
              </Button>
              <span {...stylex.props(s.hint)}>
                Sends one tiny request to the configured model.
              </span>
            </div>
            {testMut.data && (
              <p {...stylex.props(s.testResult, testMut.data.ok ? s.ok : s.fail)}>
                {testMut.data.ok
                  ? `OK — model replied: ${testMut.data.text ?? ""}`
                  : `Failed: ${testMut.data.error ?? "unknown error"}`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <SkillsCard />
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
    }
  });
  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.skills.setEnabled(name, enabled),
    onSuccess: invalidate
  });
  const removeMut = useMutation({
    mutationFn: (name: string) => api.skills.remove(name),
    onSuccess: invalidate
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviewer skills</CardTitle>
      </CardHeader>
      <CardContent style={s.stack4}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) installMut.mutate();
          }}
          {...stylex.props(s.field)}
        >
          <Label htmlFor="skill_url">Install a skill</Label>
          <div {...stylex.props(s.installRow)}>
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
          <p {...stylex.props(s.hint, s.spaced)}>
            Global — applies to every review, live on the next one. For a single repo, commit a{" "}
            <code>.claude/skills/</code> folder to that repo instead.
          </p>
          {installMut.isError && (
            <p {...stylex.props(s.error, s.spaced)}>{String(installMut.error)}</p>
          )}
        </form>

        <div {...stylex.props(s.list)}>
          {skills?.length === 0 && (
            <p {...stylex.props(s.emptyList)}>No skills installed yet.</p>
          )}
          {/* `skill`, not `s` — `s` is the stylex bundle at module scope. */}
          {skills?.map((skill, i) => (
            <div key={skill.name} {...stylex.props(s.skillRow, i > 0 && s.divider)}>
              <div {...stylex.props(s.skillMain)}>
                <div {...stylex.props(shared.row)}>
                  <span {...stylex.props(shared.dot, skill.enabled ? s.dotOn : s.dotOff)} />
                  <span {...stylex.props(s.skillName)}>{skill.name}</span>
                  <a
                    href={skill.source_url}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.props(shared.truncate, shared.ghostLink, s.sourceLink)}
                  >
                    {skill.owner}/{skill.repo}@{skill.ref.slice(0, 7)}
                  </a>
                </div>
                {skill.description && (
                  <p {...stylex.props(s.description)}>{skill.description}</p>
                )}
              </div>
              <div {...stylex.props(shared.row, s.actions)}>
                <Button
                  type="button"
                  variant="outline"
                  disabled={toggleMut.isPending}
                  onClick={() => toggleMut.mutate({ name: skill.name, enabled: !skill.enabled })}
                >
                  {skill.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(skill.name)}
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
