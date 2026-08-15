import { config } from "~/config";
import { settingValue } from "~/db";
import { DEFAULT_PROMPT } from "~/review/prompt";

export const SETTINGS = {
  API_KEY: "opencode_api_key",
  MODEL: "opencode_model",
  PROMPT: "default_prompt",
  IMPROVER_MODEL: "improver_model",
} as const;

export function resolveApiKey(): string | undefined {
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
