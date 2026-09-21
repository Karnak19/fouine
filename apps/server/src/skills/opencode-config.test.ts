import { test, expect, afterEach } from "bun:test";
import { buildOpencodeConfig } from "~/skills/materialize";
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
  // `autoupdate: false` is the v2-native key; the Dockerfile pins the CLI so
  // opencode never auto-upgrades itself inside a long-running container.
  expect(buildOpencodeConfig().autoupdate).toBe(false);
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
