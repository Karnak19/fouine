import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { repos, settingValue, settings } from "~/db";
import { createServer } from "~/server/app";
import { SETTINGS, resolveFallbackModels } from "~/settings";
import { normalizeModelList, parseModelList } from "@fouine/shared/model-list";
import {
  fallbackFilePath,
  forgetFallbackChain,
  registerFallbackChain,
} from "~/review/fallback";
// The plugin's own reader, so the test proves the two sides agree on the format.
import { parseFallbackFile } from "../../opencode-config/plugins/_model_fallback.ts";

const REPO = "acme/fallback";

afterEach(() => {
  settings.del.run({ $key: SETTINGS.FALLBACK_MODELS });
  settings.del.run({ $key: SETTINGS.CHAT_MODEL });
  repos.remove.run({ $full_name: REPO });
  forgetFallbackChain("ses_a");
  forgetFallbackChain("ses_b");
  rmSync(fallbackFilePath(), { force: true });
});

const readFile = () => parseFallbackFile(readFileSync(fallbackFilePath(), "utf8"));

// ── the list format ─────────────────────────────────────────────────────────

test("normalizeModelList keeps model specs in order, trimmed and without duplicates", () => {
  expect(
    normalizeModelList([" a/one ", "", "nope", "/x", "x/", 3, "b/two", "a/one", "o/org/model"]),
  ).toEqual(["a/one", "b/two", "o/org/model"]);
  expect(normalizeModelList("a/one")).toEqual([]);
});

test("parseModelList treats missing or broken JSON as no list", () => {
  expect(parseModelList(null)).toEqual([]);
  expect(parseModelList("")).toEqual([]);
  expect(parseModelList("{")).toEqual([]);
  expect(parseModelList('{"a":1}')).toEqual([]);
  expect(parseModelList('["a/one","b/two"]')).toEqual(["a/one", "b/two"]);
});

// ── resolution ──────────────────────────────────────────────────────────────

test("resolveFallbackModels: no setting at all means no fallback", () => {
  expect(resolveFallbackModels(null)).toEqual([]);
  expect(resolveFallbackModels({ fallback_models: null })).toEqual([]);
});

test("resolveFallbackModels: the global list applies to a repo without its own", () => {
  settings.set.run({ $key: SETTINGS.FALLBACK_MODELS, $value: '["a/one","b/two"]' });
  expect(resolveFallbackModels(null)).toEqual(["a/one", "b/two"]);
  expect(resolveFallbackModels({ fallback_models: null })).toEqual(["a/one", "b/two"]);
  // An empty repo list is the same as none: inherit.
  expect(resolveFallbackModels({ fallback_models: "[]" })).toEqual(["a/one", "b/two"]);
});

test("resolveFallbackModels: a repo list replaces the global one, never merges", () => {
  settings.set.run({ $key: SETTINGS.FALLBACK_MODELS, $value: '["a/one","b/two"]' });
  expect(resolveFallbackModels({ fallback_models: '["c/three"]' })).toEqual(["c/three"]);
});

// ── the file the plugin reads ───────────────────────────────────────────────

test("registering a chain writes it under the session id, in the plugin's format", () => {
  registerFallbackChain("ses_a", ["a/one", "b/two"]);
  registerFallbackChain("ses_b", ["c/three"]);
  expect(readFile()).toEqual({ sessions: { ses_a: ["a/one", "b/two"], ses_b: ["c/three"] } });
});

test("old-shape Command Code entries are written the way parseModel reads the main model", () => {
  registerFallbackChain("ses_a", [
    "commandcode/deepseek/deepseek-v4-flash",
    "commandcode/zai-org/GLM-5.2",
    "openrouter/deepseek/deepseek-v4-flash",
    // Same model as the first entry once normalised: kept once.
    "commandcode/deepseek-v4-flash",
  ]);
  expect(readFile()).toEqual({
    sessions: {
      ses_a: [
        "commandcode/deepseek-v4-flash",
        "commandcode/glm-5.2",
        // Only Command Code is rewritten; other org-prefixed ids stay whole.
        "openrouter/deepseek/deepseek-v4-flash",
      ],
    },
  });
});

test("forgetting a session removes only its entry", () => {
  registerFallbackChain("ses_a", ["a/one"]);
  registerFallbackChain("ses_b", ["c/three"]);
  forgetFallbackChain("ses_a");
  expect(readFile()).toEqual({ sessions: { ses_b: ["c/three"] } });
  forgetFallbackChain("ses_b");
  expect(readFile()).toEqual({ sessions: {} });
});

test("an empty chain writes nothing", () => {
  registerFallbackChain("ses_a", []);
  expect(existsSync(fallbackFilePath())).toBe(false);
});

// ── the API round trip the dashboard relies on ──────────────────────────────

test("PUT /settings stores a clean list, GET returns it, an empty list clears it", async () => {
  const app = await createServer();
  const put = (fallback_models: string) =>
    app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fallback_models }),
      }),
    );
  expect((await put(JSON.stringify(["a/one", " b/two ", "junk", "a/one"]))).status).toBe(200);
  const body = (await (await app.handle(new Request("http://localhost/api/settings"))).json()) as {
    fallback_models?: string;
  };
  expect(body.fallback_models).toBe('["a/one","b/two"]');

  await put("[]");
  const cleared = (await (
    await app.handle(new Request("http://localhost/api/settings"))
  ).json()) as { fallback_models?: string };
  expect(cleared.fallback_models).toBeUndefined();
});

test("PUT /settings rejects a fallback list that isn't a JSON array and keeps the stored one", async () => {
  settings.set.run({ $key: SETTINGS.FALLBACK_MODELS, $value: '["a/one"]' });
  const app = await createServer();
  const put = (body: Record<string, unknown>) =>
    app.handle(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  for (const bad of ["not json", '{"a":1}', '"a/one"', "null", "3"]) {
    // Another field in the same save must not be applied either.
    const res = await put({ fallback_models: bad, chat_model: "x/should-not-stick" });
    expect(res.status).toBe(400);
    expect(settingValue(SETTINGS.FALLBACK_MODELS)).toBe('["a/one"]');
    expect(settingValue(SETTINGS.CHAT_MODEL)).toBeUndefined();
  }
  // "" clears, like "[]".
  expect((await put({ fallback_models: "" })).status).toBe(200);
  expect(settingValue(SETTINGS.FALLBACK_MODELS)).toBeUndefined();
});

test("PUT /repos sets, keeps and clears the repo's own list", async () => {
  repos.upsert.run({ $full_name: REPO, $installation_id: 1, $prompt: null, $model: null });
  const app = await createServer();
  const put = (body: Record<string, unknown>) =>
    app.handle(
      new Request(`http://localhost/api/repos/${REPO}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  let row = (await (await put({ fallback_models: ["c/three", "nope"] })).json()) as {
    fallback_models: string | null;
  };
  expect(row.fallback_models).toBe('["c/three"]');

  // Absent keeps it, so saving another field never wipes the list.
  row = (await (await put({ prompt: "p" })).json()) as typeof row;
  expect(row.fallback_models).toBe('["c/three"]');

  row = (await (await put({ fallback_models: [] })).json()) as typeof row;
  expect(row.fallback_models).toBeNull();
});
