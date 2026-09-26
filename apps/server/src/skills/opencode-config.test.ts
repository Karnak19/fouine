import { test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildOpencodeConfig, writeOpencodeConfig } from "~/skills/materialize";
import { toConfigKey, commandcodeModels, commandcodeModelCatalog } from "~/review/commandcode";
import { config } from "~/config";
import { settings } from "~/db";
import { SETTINGS } from "~/settings";

const original = process.env.POSTHOG_API_KEY;
const catalogPath = () => join(config.opencode.runtimeDir, "plugins", "commandcode-models.json");

afterEach(() => {
  if (original === undefined) delete process.env.POSTHOG_API_KEY;
  else process.env.POSTHOG_API_KEY = original;
  settings.del.run({ $key: SETTINGS.COMMANDCODE_API_KEY });
  rmSync(catalogPath(), { force: true });
});

const withCommandcodeKey = () =>
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });

// seedOpencodeConfig creates the runtime dir on boot; tests here call
// writeOpencodeConfig directly (as PUT /api/settings does on a live server).
const writeConfig = () => {
  mkdirSync(config.opencode.runtimeDir, { recursive: true });
  writeOpencodeConfig();
};

test("the PostHog plugin is declared only when an API key is set", () => {
  delete process.env.POSTHOG_API_KEY;
  expect(buildOpencodeConfig().plugin).toBeUndefined();

  process.env.POSTHOG_API_KEY = "phc_test";
  expect(buildOpencodeConfig().plugin).toEqual(["@posthog/opencode"]);

  // Command Code is a locally-shipped plugin, not an npm package, so it is
  // never in the `plugin` list even with a key set.
  withCommandcodeKey();
  expect(buildOpencodeConfig().plugin).toEqual(["@posthog/opencode"]);
});

test("self-update is disabled (the Dockerfile pins the CLI to the SDK's version)", () => {
  // `autoupdate: false` is the v2-native key; the Dockerfile pins the CLI so
  // opencode never auto-upgrades itself inside a long-running container.
  expect(buildOpencodeConfig().autoupdate).toBe(false);
});

test("opencode.json never declares Command Code, key or not", () => {
  // The shipped plugin owns the provider, so the generated config must not
  // mention it: no provider block, no npm plugin, nothing to keep in sync.
  const withoutKey = buildOpencodeConfig();
  expect(withoutKey.provider).toBeUndefined();
  expect(withoutKey.plugin).toBeUndefined();

  withCommandcodeKey();
  const withKey = buildOpencodeConfig();
  expect(withKey.provider).toBeUndefined();
  expect(withKey.plugin).toBeUndefined();
  expect(JSON.stringify(withKey)).not.toContain("commandcode");
});

test("with a key, the plugin's catalog file is materialised and matches the picker", () => {
  withCommandcodeKey();
  writeConfig();

  expect(existsSync(catalogPath())).toBe(true);
  const raw = readFileSync(catalogPath(), "utf8");
  // The key never reaches disk; only the model catalog does.
  expect(raw).not.toContain("cc-key");
  expect(raw).not.toContain("apiKey");

  const written = JSON.parse(raw) as Record<string, { id: string }>;
  const keys = Object.keys(written);
  expect(keys.length).toBeGreaterThan(10);
  // Every key is the flattened form of the full upstream id it carries.
  for (const [key, m] of Object.entries(written)) expect(toConfigKey(m.id)).toBe(key);
  // The file is exactly what the picker advertises and what the plugin reads.
  expect(commandcodeModels().map((m) => m.id).sort()).toEqual([...keys].sort());
  expect(raw).toBe(JSON.stringify(commandcodeModelCatalog()));
});

test("without a key, the plugin's catalog file is absent", () => {
  // A stray file from a previous run must be cleared, or the plugin would
  // register the gateway with no credential to authenticate it.
  withCommandcodeKey();
  writeConfig();
  expect(existsSync(catalogPath())).toBe(true);

  settings.del.run({ $key: SETTINGS.COMMANDCODE_API_KEY });
  writeConfig();
  expect(existsSync(catalogPath())).toBe(false);
});
