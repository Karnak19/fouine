import { test, expect, afterEach } from "bun:test";
import { buildOpencodeConfig, reviewOpencodeConfig } from "~/skills/materialize";
import { COMMANDCODE_PLUGIN, COMMANDCODE_PLUGIN_VERSION, toConfigKey } from "~/review/commandcode";
import { settings } from "~/db";
import { SETTINGS } from "~/settings";

const original = process.env.POSTHOG_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.POSTHOG_API_KEY;
  else process.env.POSTHOG_API_KEY = original;
  settings.del.run({ $key: SETTINGS.COMMANDCODE_API_KEY });
});

const withCommandcodeKey = () =>
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });

test("the PostHog plugin is declared only when an API key is set", () => {
  delete process.env.POSTHOG_API_KEY;
  expect(buildOpencodeConfig().plugin).toBeUndefined();

  process.env.POSTHOG_API_KEY = "phc_test";
  expect(buildOpencodeConfig().plugin).toEqual(["@posthog/opencode"]);

  // Both plugins live in the one array.
  withCommandcodeKey();
  expect(buildOpencodeConfig().plugin).toEqual([COMMANDCODE_PLUGIN, "@posthog/opencode"]);
});

test("self-update is disabled (the Dockerfile pins the CLI to the SDK's version)", () => {
  expect(buildOpencodeConfig().autoupdate).toBe(false);
});

test("bash denies dependency installs but stays allowed by default", () => {
  const bash = (buildOpencodeConfig().permission as { bash: Record<string, string> }).bash;

  // A blanket allow must come FIRST, so the later denies win (last match wins).
  expect(Object.keys(bash)[0]).toBe("*");
  expect(bash["*"]).toBe("allow");

  // Both the bare and the trailing-* form, so we don't depend on opencode's
  // trailing-" *" special case to catch an argument-less install.
  for (const cmd of ["bun install", "npm install", "npm ci", "pnpm install", "yarn add"]) {
    expect(bash[cmd]).toBe("deny");
    expect(bash[`${cmd} *`]).toBe("deny");
  }
});

test("a '*' deny is never emitted (it would strip bash from the model's tools)", () => {
  const perms = buildOpencodeConfig().permission as Record<string, Record<string, string>>;
  for (const table of Object.values(perms)) {
    expect(table["*"]).not.toBe("deny");
  }
});

test("the per-spawn review config only exists when the toggle is on", () => {
  expect(reviewOpencodeConfig(false).permission).toBeUndefined();
  expect(Object.keys(reviewOpencodeConfig(false))).toEqual([]);

  const bash = (reviewOpencodeConfig(true).permission as { bash: Record<string, string> }).bash;
  // No "*" key at all: the dir's opencode.json already carries the blanket allow
  // at position 0, and re-sending it here would be deduped in place, not moved.
  expect(bash["*"]).toBeUndefined();
  for (const cmd of ["bun test", "bunx oxlint", "tsc", "bun run build", "npm test"]) {
    expect(bash[cmd]).toBe("deny");
    expect(bash[`${cmd} *`]).toBe("deny");
  }
  expect(Object.values(bash).every((v) => v === "deny")).toBe(true);
});

test("no builder ever emits a '*' deny, in either toggle state", () => {
  const tables = [
    ...Object.values(buildOpencodeConfig().permission as Record<string, Record<string, string>>),
    ...Object.values(
      (reviewOpencodeConfig(true).permission ?? {}) as Record<string, Record<string, string>>,
    ),
    ...Object.values(
      (reviewOpencodeConfig(false).permission ?? {}) as Record<string, Record<string, string>>,
    ),
  ];
  for (const table of tables) expect(table["*"]).not.toBe("deny");
});

test("the blanket allow is first and every deny comes after it", () => {
  const bash = (buildOpencodeConfig().permission as { bash: Record<string, string> }).bash;
  const keys = Object.keys(bash);
  expect(keys.indexOf("*")).toBe(0);
  for (const [i, key] of keys.entries()) {
    if (bash[key] === "deny") expect(i).toBeGreaterThan(0);
  }
});

test("Command Code is absent from the config until its key is configured", () => {
  // No key: no provider block and no plugin, so a fresh deployment never fetches
  // the package from npm for a provider it cannot use.
  const cfg = buildOpencodeConfig();
  expect(cfg.provider).toBeUndefined();
  expect(cfg.plugin).toBeUndefined();
});

test("with a key, Command Code is declared as an OpenAI-compatible provider whose models the plugin fills", () => {
  withCommandcodeKey();
  const cfg = buildOpencodeConfig();
  // models.dev doesn't know Command Code, so this block is opencode's only
  // knowledge of it. The key travels through auth.set at spawn time instead.
  const provider = (cfg.provider as Record<string, Record<string, unknown>>).commandcode!;
  expect(provider.npm).toBe("@ai-sdk/openai-compatible");
  expect(provider.name).toBe("Command Code");
  expect(provider.options).toEqual({ baseURL: "https://api.commandcode.ai/provider/v1" });
  // No `models` key: the plugin's config hook only fills the list when it is
  // absent, and hand-writing one here is exactly the stale list this replaced.
  expect(provider.models).toBeUndefined();
  expect(JSON.stringify(provider)).not.toContain("apiKey");
  expect(JSON.stringify(provider)).not.toContain("cc-key");
  expect(cfg.plugin).toEqual([COMMANDCODE_PLUGIN]);
});

test("the plugin spec is a plain pinned npm spec, no subpath", () => {
  // opencode 1.18.30 passes the string to an npm install as-is and resolves the
  // package's ./server export itself; npm-package-arg reads `pkg@x/server` as a
  // git spec and `@scope/pkg/server` as a directory, so either form breaks it.
  expect(COMMANDCODE_PLUGIN).toBe(`@brainervirus/opencode-commandcode@${COMMANDCODE_PLUGIN_VERSION}`);
  expect(COMMANDCODE_PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(COMMANDCODE_PLUGIN.split("/").length).toBe(2);
});

test("the real plugin hook fills our provider block with the same keys the picker offers", async () => {
  withCommandcodeKey();
  const cfg = buildOpencodeConfig();
  const { default: plugin } = await import("@brainervirus/opencode-commandcode/server");
  const hooks = (await plugin()) as { config: (c: Record<string, unknown>) => Promise<void> };
  await hooks.config(cfg);
  const provider = (cfg.provider as Record<string, Record<string, unknown>>).commandcode!;
  const models = provider.models as Record<string, { id: string }>;
  const keys = Object.keys(models);
  expect(keys.length).toBeGreaterThan(10);
  // The hook keeps what we declared and adds the catalog.
  expect(provider.npm).toBe("@ai-sdk/openai-compatible");
  // Our mirror of the plugin's toConfigKey agrees with the plugin on every entry.
  for (const [key, m] of Object.entries(models)) expect(toConfigKey(m.id)).toBe(key);
  const { commandcodeModels } = await import("~/review/commandcode");
  expect(commandcodeModels().map((m) => m.id).sort()).toEqual(keys.sort());
});
