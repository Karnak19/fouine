import { config } from "~/config";
import { settingValue } from "~/db";
import { DEFAULT_PROMPT } from "~/review/prompt";

export const SETTINGS = {
  API_KEY: "opencode_api_key",
  ZAI_API_KEY: "zai_api_key",
  MODEL: "opencode_model",
  PROMPT: "default_prompt",
  IMPROVER_MODEL: "improver_model",
} as const;

// opencode's provider id for the Z.ai GLM Coding Plan. Models under it are
// specced as `zai-coding-plan/glm-5.2`.
export const ZAI_PROVIDER = "zai-coding-plan";

// The key opencode should authenticate the model's provider with. GLM Coding
// Plan is billed by Z.ai, not by the OpenCode provider, so it carries its own
// key; every other provider falls back to the single OpenCode key.
export function hasOpencodeKey(): boolean {
  return !!(settingValue(SETTINGS.API_KEY) ?? config.opencode.apiKey);
}

export function hasZaiKey(): boolean {
  return !!(settingValue(SETTINGS.ZAI_API_KEY) ?? config.opencode.zaiApiKey);
}

export function resolveApiKey(providerID?: string): string | undefined {
  if (providerID === ZAI_PROVIDER) {
    const zai = settingValue(SETTINGS.ZAI_API_KEY) ?? config.opencode.zaiApiKey;
    if (zai) return zai;
  }
  return settingValue(SETTINGS.API_KEY) ?? config.opencode.apiKey;
}

export function resolveDefaultModel(): string {
  return settingValue(SETTINGS.MODEL) ?? config.review.defaultModel;
}

// The outer-loop improver's model — global (its output is a REVIEW.md proposal,
// not a review, so per-repo model overrides don't apply). Falls back to the
// review default when unset.
export function resolveImproverModel(): string {
  return settingValue(SETTINGS.IMPROVER_MODEL) ?? resolveDefaultModel();
}

export function resolvePrompt(repoPrompt: string | null): string {
  return repoPrompt?.trim() || settingValue(SETTINGS.PROMPT) || DEFAULT_PROMPT;
}
