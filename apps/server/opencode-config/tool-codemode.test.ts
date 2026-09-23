import { expect, test } from "bun:test";

// Deliberately NOT in plugins/: opencode discovers plugins by globbing
// {plugin,plugins}/*.{ts,js} in this dir, so a test file next to the plugins
// would be loaded as one — importing bun:test into the review runtime. One
// level up is outside the glob (same reasoning as cap-bash-timeout.test.ts).
//
// opencode 2.x's Code Mode hides any tool whose `options.codemode !== false`
// behind a single `execute` catalog tool, callable only as JS
// (`tools.<ns>.name(...)`). fouine's plugin tools (via `addTool` in _ctx.ts)
// are registered TWICE to live in both worlds: a direct copy our prompts and
// agent `tools:` frontmatter can name directly, and a Code Mode copy under the
// `fouine` namespace (with `permission` pinned to the bare name, so an agent
// `.md` deny like `mark_issue_ready: false` still applies — opencode falls
// back to the internal `fouine_<name>` key otherwise). This drives each
// plugin's `setup` with a fake `ctx.tool.transform`/`editor.add`/`namespace`,
// exactly as opencode would, and asserts both copies of every tool are
// registered correctly, so a new tool (or a regression in `addTool`) can't
// silently lose either one.
interface CapturedTool {
  name: string;
  options?: { codemode?: boolean; namespace?: string; pinned?: boolean; permission?: string };
}

const capture = async (path: string): Promise<CapturedTool[]> => {
  const mod = await import(path);
  const captured: CapturedTool[] = [];
  const namespaces: Array<{ name: string; description: string }> = [];
  const editor = {
    add: (tool: CapturedTool) => {
      captured.push(tool);
    },
    namespace: (ns: { name: string; description: string }) => {
      namespaces.push(ns);
    },
  };
  const ctx = {
    tool: {
      transform: async (cb: (editor: typeof editor) => void | Promise<void>) => {
        await cb(editor);
      },
    },
  };
  await mod.default.setup(ctx as never);
  // Every plugin under test registers exactly one namespace, `fouine`.
  expect(namespaces.length).toBeGreaterThan(0);
  for (const ns of namespaces) expect(ns.name).toBe("fouine");
  return captured;
};

// Every plugin file in plugins/ that registers a model-facing tool, i.e. not
// the leading-underscore helper modules and not cap-bash-timeout.ts (which
// registers an execute.before hook, not a tool).
const toolPlugins = [
  "get_ci_results",
  "get_prior_reviews",
  "mark_issue_ready",
  "post_comment",
  "post_review",
  "propose_review_notes",
];

test.each(toolPlugins)("%s registers a direct copy and a Code Mode copy", async (plugin) => {
  const tools = await capture(`./plugins/${plugin}.ts`);
  const byName = new Map<string, CapturedTool[]>();
  for (const tool of tools) {
    const list = byName.get(tool.name) ?? [];
    list.push(tool);
    byName.set(tool.name, list);
  }

  expect(byName.size).toBeGreaterThan(0);
  for (const [name, copies] of byName) {
    expect(copies).toHaveLength(2);

    const direct = copies.filter((t) => t.options?.codemode === false);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.options?.namespace).toBeUndefined();

    const codeMode = copies.filter((t) => t.options?.codemode !== false);
    expect(codeMode).toHaveLength(1);
    expect(codeMode[0]?.options?.namespace).toBe("fouine");
    expect(codeMode[0]?.options?.permission).toBe(name);
  }
});
