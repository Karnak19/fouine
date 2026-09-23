import { test, expect, afterEach } from "bun:test";
import { settings } from "~/db";
import {
  SETTINGS,
  ZAI_PROVIDER,
  COMMANDCODE_PROVIDER,
  resolveApiKey,
  resolveAutoMerge,
  resolveMergeMethod,
  resolveRefineEnabled,
  resolveRefinePrompt,
  resolveImplementEnabled,
  resolveImplementLabel,
  resolveImplementPrompt,
  resolveRefineModel,
  resolveImplementModel,
  resolveChatModel,
  resolveAutoReady,
  DEFAULT_IMPLEMENT_LABEL,
  opencodeKeySource,
  zaiKeySource,
  commandcodeKeySource,
  hasOpencodeKey,
  hasZaiKey,
  hasCommandcodeKey,
} from "~/settings";
import { config } from "~/config";
import { DEFAULT_REFINE_PROMPT } from "~/review/refine-prompt";
import { DEFAULT_IMPLEMENT_PROMPT } from "~/review/implement-prompt";

afterEach(() => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "" });
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "" });
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "" });
  settings.del.run({ $key: SETTINGS.AUTO_MERGE });
  settings.del.run({ $key: SETTINGS.MERGE_METHOD });
  settings.del.run({ $key: SETTINGS.REFINE_ENABLED });
  settings.del.run({ $key: SETTINGS.DEFAULT_REFINE_PROMPT });
  settings.del.run({ $key: SETTINGS.IMPLEMENT_ENABLED });
  settings.del.run({ $key: SETTINGS.IMPLEMENT_LABEL });
  settings.del.run({ $key: SETTINGS.DEFAULT_IMPLEMENT_PROMPT });
  settings.del.run({ $key: SETTINGS.MODEL });
  settings.del.run({ $key: SETTINGS.REFINE_MODEL });
  settings.del.run({ $key: SETTINGS.IMPLEMENT_MODEL });
  settings.del.run({ $key: SETTINGS.CHAT_MODEL });
  settings.del.run({ $key: SETTINGS.AUTO_READY });
});

test("resolveAutoMerge: repo override wins whenever set, 0 included", () => {
  expect(resolveAutoMerge(null)).toBe(false); // default off
  settings.set.run({ $key: SETTINGS.AUTO_MERGE, $value: "1" });
  expect(resolveAutoMerge(null)).toBe(true); // inherits the global on
  expect(resolveAutoMerge(0)).toBe(false); // explicit repo override beats a global "on"
  expect(resolveAutoMerge(1)).toBe(true);
});

test("resolveMergeMethod: repo override wins, falls back to global, defaults to squash", () => {
  expect(resolveMergeMethod(null)).toBe("squash");
  settings.set.run({ $key: SETTINGS.MERGE_METHOD, $value: "rebase" });
  expect(resolveMergeMethod(null)).toBe("rebase");
  expect(resolveMergeMethod("merge")).toBe("merge");
  // An invalid stored value (shouldn't happen past the API's 400, but never trust storage) falls back.
  expect(resolveMergeMethod("bogus")).toBe("rebase");
});

test("GLM Coding Plan models use the Z.ai key, other providers use the OpenCode key", () => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });

  expect(resolveApiKey(ZAI_PROVIDER)).toBe("zai-key");
  expect(resolveApiKey("opencode-go")).toBe("oc-key");
  expect(resolveApiKey()).toBe("oc-key");
});

test("a GLM model never borrows the OpenCode key", () => {
  // Undefined, not the OpenCode key: setProviderApiKey then skips auth.set and
  // leaves whatever `opencode auth login` established for the provider intact.
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  expect(resolveApiKey(ZAI_PROVIDER)).toBeUndefined();
});

test("the Z.ai key never leaks to a non-GLM provider", () => {
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });
  expect(resolveApiKey("opencode-go")).toBeFalsy();
});

// config is `as const` in production code (nothing should mutate it at
// runtime) but these tests need to exercise the env-fallback branch, so the
// cast to a mutable view is local to this file only.
const mutableOpencodeConfig = config.opencode as unknown as {
  apiKey?: string;
  zaiApiKey?: string;
  commandcodeApiKey?: string;
};

// keySource is the single source of truth GET /settings reports and has*Key()
// is now derived from it — an explicit empty-string row must read exactly the
// same as no row at all, on both sides.
test("opencodeKeySource: dashboard row wins over env, empty row falls back to env", () => {
  const savedEnv = mutableOpencodeConfig.apiKey;
  mutableOpencodeConfig.apiKey = "env-key";
  try {
    expect(opencodeKeySource()).toBe("env");
    expect(hasOpencodeKey()).toBe(true);

    settings.set.run({ $key: SETTINGS.API_KEY, $value: "dash-key" });
    expect(opencodeKeySource()).toBe("dashboard");
    expect(hasOpencodeKey()).toBe(true);

    // An explicit "" row deletes the row (the PUT handler's setKey), so this
    // is really "no dashboard row" — falls back to env, not "none".
    settings.set.run({ $key: SETTINGS.API_KEY, $value: "" });
    expect(opencodeKeySource()).toBe("env");
  } finally {
    mutableOpencodeConfig.apiKey = savedEnv;
  }
});

test("zaiKeySource/commandcodeKeySource: none when neither a row nor an env value exists", () => {
  const savedZai = mutableOpencodeConfig.zaiApiKey;
  const savedCc = mutableOpencodeConfig.commandcodeApiKey;
  mutableOpencodeConfig.zaiApiKey = undefined;
  mutableOpencodeConfig.commandcodeApiKey = undefined;
  try {
    expect(zaiKeySource()).toBe("none");
    expect(hasZaiKey()).toBe(false);
    expect(commandcodeKeySource()).toBe("none");
    expect(hasCommandcodeKey()).toBe(false);

    settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });
    settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });
    expect(zaiKeySource()).toBe("dashboard");
    expect(commandcodeKeySource()).toBe("dashboard");
  } finally {
    mutableOpencodeConfig.zaiApiKey = savedZai;
    mutableOpencodeConfig.commandcodeApiKey = savedCc;
  }
});

test("Command Code models use the Command Code key, other providers use the OpenCode key", () => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });

  expect(resolveApiKey(COMMANDCODE_PROVIDER)).toBe("cc-key");
  expect(resolveApiKey("opencode-go")).toBe("oc-key");
  expect(resolveApiKey(ZAI_PROVIDER)).toBeUndefined();
});

test("a Command Code model never borrows the OpenCode key", () => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  expect(resolveApiKey(COMMANDCODE_PROVIDER)).toBeUndefined();
});

test("the Command Code key never leaks to another provider", () => {
  settings.set.run({ $key: SETTINGS.COMMANDCODE_API_KEY, $value: "cc-key" });
  expect(resolveApiKey("opencode-go")).toBeFalsy();
  expect(resolveApiKey(ZAI_PROVIDER)).toBeUndefined();
});

test("resolveRefineEnabled: default off, repo override wins whenever set", () => {
  expect(resolveRefineEnabled(null)).toBe(false);
  settings.set.run({ $key: SETTINGS.REFINE_ENABLED, $value: "1" });
  expect(resolveRefineEnabled(null)).toBe(true);
  expect(resolveRefineEnabled(0)).toBe(false); // explicit repo off beats a global on
  expect(resolveRefineEnabled(1)).toBe(true);
});

test("resolveAutoReady: default off, repo override wins whenever set", () => {
  expect(resolveAutoReady(null)).toBe(false);
  settings.set.run({ $key: SETTINGS.AUTO_READY, $value: "1" });
  expect(resolveAutoReady(null)).toBe(true);
  expect(resolveAutoReady(0)).toBe(false); // explicit repo off beats a global on
  expect(resolveAutoReady(1)).toBe(true);
});

test("resolveRefinePrompt: repo override, then global, then the built-in default", () => {
  expect(resolveRefinePrompt(null)).toBe(DEFAULT_REFINE_PROMPT);
  settings.set.run({ $key: SETTINGS.DEFAULT_REFINE_PROMPT, $value: "global focus" });
  expect(resolveRefinePrompt(null)).toBe("global focus");
  expect(resolveRefinePrompt("repo focus")).toBe("repo focus");
  // Whitespace-only is not an override.
  expect(resolveRefinePrompt("   ")).toBe("global focus");
});

test("resolveImplementEnabled: default off, repo override wins whenever set", () => {
  expect(resolveImplementEnabled(null)).toBe(false);
  settings.set.run({ $key: SETTINGS.IMPLEMENT_ENABLED, $value: "1" });
  expect(resolveImplementEnabled(null)).toBe(true);
  expect(resolveImplementEnabled(0)).toBe(false); // explicit repo off beats a global on
  expect(resolveImplementEnabled(1)).toBe(true);
});

test("resolveImplementLabel: repo override, then global, then the built-in default", () => {
  expect(resolveImplementLabel(null)).toBe(DEFAULT_IMPLEMENT_LABEL);
  settings.set.run({ $key: SETTINGS.IMPLEMENT_LABEL, $value: "ship-it" });
  expect(resolveImplementLabel(null)).toBe("ship-it");
  expect(resolveImplementLabel("go")).toBe("go");
  // Whitespace-only is not an override.
  expect(resolveImplementLabel("   ")).toBe("ship-it");
});

test("resolveImplementPrompt: repo override, then global, then the built-in default", () => {
  expect(resolveImplementPrompt(null)).toBe(DEFAULT_IMPLEMENT_PROMPT);
  settings.set.run({ $key: SETTINGS.DEFAULT_IMPLEMENT_PROMPT, $value: "global focus" });
  expect(resolveImplementPrompt(null)).toBe("global focus");
  expect(resolveImplementPrompt("repo focus")).toBe("repo focus");
  // Whitespace-only is not an override.
  expect(resolveImplementPrompt("   ")).toBe("global focus");
});

test("resolveRefineModel: repo override, then the repo review model, then the global refiner default, then the review default", () => {
  expect(resolveRefineModel(undefined)).toBe("opencode-go/deepseek-v4-flash");
  settings.set.run({ $key: SETTINGS.MODEL, $value: "global/model" });
  settings.set.run({ $key: SETTINGS.REFINE_MODEL, $value: "refine-global/model" });
  // Global refiner default beats the review default when no repo overrides.
  expect(resolveRefineModel(undefined)).toBe("refine-global/model");
  // A repo pinned to a review model refines with it — repo beats the global
  // agent default.
  expect(resolveRefineModel({ refine_model: null, model: "review/model" })).toBe("review/model");
  expect(resolveRefineModel({ refine_model: "refine/model", model: "review/model" })).toBe(
    "refine/model",
  );
});

test("resolveImplementModel: repo override, then the repo review model, then the global implementer default, then the review default", () => {
  expect(resolveImplementModel(undefined)).toBe("opencode-go/deepseek-v4-flash");
  settings.set.run({ $key: SETTINGS.MODEL, $value: "global/model" });
  settings.set.run({ $key: SETTINGS.IMPLEMENT_MODEL, $value: "implement-global/model" });
  expect(resolveImplementModel(undefined)).toBe("implement-global/model");
  expect(resolveImplementModel({ implement_model: null, model: "review/model" })).toBe(
    "review/model",
  );
  expect(
    resolveImplementModel({ implement_model: "implement/model", model: "review/model" }),
  ).toBe("implement/model");
});

test("resolveChatModel: dashboard setting, then OPENCODE_CHAT_MODEL / config, then the repo default", () => {
  // config.chat.model already holds the env var when set, else the repo default.
  expect(resolveChatModel()).toBe(config.chat.model);
  if (!process.env.OPENCODE_CHAT_MODEL) {
    expect(resolveChatModel()).toBe("opencode-go/deepseek-v4.1-flash");
  }
  settings.set.run({ $key: SETTINGS.CHAT_MODEL, $value: "chat/model" });
  expect(resolveChatModel()).toBe("chat/model");
  // An empty string is not an override — it falls through to the env/default.
  settings.set.run({ $key: SETTINGS.CHAT_MODEL, $value: "" });
  expect(resolveChatModel()).toBe(config.chat.model);
  // Chat never inherits the review model.
  settings.set.run({ $key: SETTINGS.MODEL, $value: "review/model" });
  expect(resolveChatModel()).toBe(config.chat.model);
});
