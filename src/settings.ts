import { config } from "~/config";
import { settingValue } from "~/db";
import { DEFAULT_PROMPT } from "~/review/prompt";

export const SETTINGS = {
  API_KEY: "opencode_api_key",
  MODEL: "opencode_model",
  PROMPT: "default_prompt",
  IMPROVER_MODEL: "improver_model",
  TRIGGERS: "review_triggers",
} as const;

// Which pull_request webhook actions start a review, and whether drafts count.
// Configurable from the dashboard so a new GitHub workflow (say, PRs opened as
// drafts by `gh stack submit`) doesn't need a code change and a redeploy.
export const TRIGGER_ACTIONS = ["opened", "synchronize", "reopened", "ready_for_review"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

export interface ReviewTriggers {
  actions: TriggerAction[];
  reviewDrafts: boolean;
}

// Exactly today's hardcoded behaviour: the four actions, drafts skipped. A fresh
// install has no settings row and no per-repo value and must land here.
export const DEFAULT_TRIGGERS: ReviewTriggers = {
  actions: [...TRIGGER_ACTIONS],
  reviewDrafts: false,
};

const isTriggerAction = (v: unknown): v is TriggerAction =>
  typeof v === "string" && (TRIGGER_ACTIONS as readonly string[]).includes(v);

// Returns null for anything we can't make sense of, so callers fall back rather
// than throw — a hand-edited or half-written settings row must never be able to
// take the webhook path down. An empty actions array is legitimate ("never
// auto-review"), so it is NOT treated as unusable.
export function parseTriggers(raw: string | null | undefined): ReviewTriggers | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { actions?: unknown; reviewDrafts?: unknown };
  if (!Array.isArray(obj.actions)) return null;
  return {
    // Unknown action strings are dropped rather than rejected — a future GitHub
    // action name in an old row shouldn't invalidate the rest of the rule.
    actions: [...new Set(obj.actions.filter(isTriggerAction))],
    reviewDrafts: obj.reviewDrafts === true,
  };
}

// Per-repo override wins whole-object; null/unusable falls through to the global
// setting, then to the defaults.
export function resolveTriggers(repoTriggers: string | null): ReviewTriggers {
  return (
    parseTriggers(repoTriggers) ?? parseTriggers(settingValue(SETTINGS.TRIGGERS)) ?? DEFAULT_TRIGGERS
  );
}

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
