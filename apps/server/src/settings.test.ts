import { test, expect, afterEach } from "bun:test";
import { settings } from "~/db";
import { SETTINGS, ZAI_PROVIDER, resolveApiKey } from "~/settings";

afterEach(() => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "" });
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "" });
});

test("GLM Coding Plan models use the Z.ai key, other providers use the OpenCode key", () => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });

  expect(resolveApiKey(ZAI_PROVIDER)).toBe("zai-key");
  expect(resolveApiKey("opencode-go")).toBe("oc-key");
  expect(resolveApiKey()).toBe("oc-key");
});

test("a GLM model falls back to the OpenCode key when no Z.ai key is set", () => {
  settings.set.run({ $key: SETTINGS.API_KEY, $value: "oc-key" });
  expect(resolveApiKey(ZAI_PROVIDER)).toBe("oc-key");
});

test("the Z.ai key never leaks to a non-GLM provider", () => {
  settings.set.run({ $key: SETTINGS.ZAI_API_KEY, $value: "zai-key" });
  expect(resolveApiKey("opencode-go")).toBeFalsy();
});
