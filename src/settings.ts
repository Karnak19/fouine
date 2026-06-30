import { config } from "~/config";
import { settingValue } from "~/db";
import { DEFAULT_PROMPT } from "~/review/prompt";

export const SETTINGS = {
  API_KEY: "opencode_api_key",
  MODEL: "opencode_model",
  PROMPT: "default_prompt",
} as const;

export function resolveApiKey(): string | undefined {
  return settingValue(SETTINGS.API_KEY) ?? config.opencode.apiKey;
}

export function resolveDefaultModel(): string {
  return settingValue(SETTINGS.MODEL) ?? config.review.defaultModel;
}

export function resolvePrompt(repoPrompt: string | null): string {
  return repoPrompt?.trim() || settingValue(SETTINGS.PROMPT) || DEFAULT_PROMPT;
}
