import { test, expect, afterEach } from "bun:test";
import { settings } from "~/db";
import {
  SETTINGS,
  ZAI_PROVIDER,
  resolveApiKey,
  resolveAutoMerge,
  resolveMergeMethod,
  resolveRefineEnabled,
  resolveRefinePrompt,
} from "~/settings";
import { DEFAULT_REFINE_PROMPT } from "~/review/refine-prompt";

afterEach(() => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "" });
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "" });
  settings.del.run({ $key: SETTINGS.AUTO_MERGE });
  settings.del.run({ $key: SETTINGS.MERGE_METHOD });
  settings.del.run({ $key: SETTINGS.REFINE_ENABLED });
  settings.del.run({ $key: SETTINGS.DEFAULT_REFINE_PROMPT });
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

test("resolveRefineEnabled: default off, repo override wins whenever set", () => {
  expect(resolveRefineEnabled(null)).toBe(false);
  settings.set.run({ $key: SETTINGS.REFINE_ENABLED, $value: "1" });
  expect(resolveRefineEnabled(null)).toBe(true);
  expect(resolveRefineEnabled(0)).toBe(false); // explicit repo off beats a global on
  expect(resolveRefineEnabled(1)).toBe(true);
});

test("resolveRefinePrompt: repo override, then global, then the built-in default", () => {
  expect(resolveRefinePrompt(null)).toBe(DEFAULT_REFINE_PROMPT);
  settings.set.run({ $key: SETTINGS.DEFAULT_REFINE_PROMPT, $value: "global focus" });
  expect(resolveRefinePrompt(null)).toBe("global focus");
  expect(resolveRefinePrompt("repo focus")).toBe("repo focus");
  // Whitespace-only is not an override.
  expect(resolveRefinePrompt("   ")).toBe("global focus");
});
