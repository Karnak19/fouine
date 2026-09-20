import { config } from "~/config";
import { settingValue } from "~/db";
import type { RepoRow } from "@fouine/shared";
import { DEFAULT_PROMPT } from "~/review/prompt";
import { DEFAULT_REFINE_PROMPT } from "~/review/refine-prompt";
import { DEFAULT_IMPLEMENT_PROMPT } from "~/review/implement-prompt";

export const SETTINGS = {
  API_KEY: "opencode_api_key",
  ZAI_API_KEY: "zai_api_key",
  MODEL: "opencode_model",
  PROMPT: "default_prompt",
  IMPROVER_MODEL: "improver_model",
  REFINE_MODEL: "refine_model",
  IMPLEMENT_MODEL: "implement_model",
  DENY_TEST_COMMANDS: "deny_test_commands",
  AUTO_MERGE: "auto_merge",
  MERGE_METHOD: "merge_method",
  REFINE_ENABLED: "refine_enabled",
  DEFAULT_REFINE_PROMPT: "default_refine_prompt",
  IMPLEMENT_ENABLED: "implement_enabled",
  IMPLEMENT_LABEL: "implement_label",
  DEFAULT_IMPLEMENT_PROMPT: "default_implement_prompt",
  AUTO_READY: "auto_ready",
} as const;

// The label that, applied to an issue, triggers the implementer when
// implement_enabled is on. Overridable per-repo and globally.
export const DEFAULT_IMPLEMENT_LABEL = "fouine-ready";

export type MergeMethod = "merge" | "squash" | "rebase";
export const MERGE_METHODS: readonly MergeMethod[] = ["merge", "squash", "rebase"];

// opencode's provider id for the Z.ai GLM Coding Plan. Models under it are
// specced as `zai-coding-plan/glm-5.2`.
export const ZAI_PROVIDER = "zai-coding-plan";

// The key opencode should authenticate the model's provider with. GLM Coding
// Plan is billed by Z.ai, not by the OpenCode provider, so it carries its own
// key; every other provider uses the single OpenCode key.
export function hasOpencodeKey(): boolean {
  return !!(settingValue(SETTINGS.API_KEY) ?? config.opencode.apiKey);
}

export function hasZaiKey(): boolean {
  return !!(settingValue(SETTINGS.ZAI_API_KEY) ?? config.opencode.zaiApiKey);
}

export function resolveApiKey(providerID?: string): string | undefined {
  // No fallback to the OpenCode key here: it would authenticate as the wrong
  // account and, worse, overwrite any credential the user set up with
  // `opencode auth login`. Undefined leaves opencode's own auth alone.
  if (providerID === ZAI_PROVIDER) {
    return settingValue(SETTINGS.ZAI_API_KEY) || config.opencode.zaiApiKey || undefined;
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

// Whether the reviewer is denied test/lint/build/typecheck commands. The repo
// override wins whenever it is set (0 included — an explicit allow must survive
// the global default flipping on); otherwise the global setting, which is only
// on for the literal "1". Default OFF: denying the commands without a CI-results
// tool (#90) just loses the agent information.
export function resolveDenyTestCommands(repoValue: number | null): boolean {
  if (repoValue !== null) return repoValue === 1;
  return settingValue(SETTINGS.DENY_TEST_COMMANDS) === "1";
}

export function resolvePrompt(repoPrompt: string | null): string {
  return repoPrompt?.trim() || settingValue(SETTINGS.PROMPT) || DEFAULT_PROMPT;
}

// Auto-merge opt-in. Same repo-wins, 0-included shape as resolveDenyTestCommands.
// Default OFF: a setting alone must never merge anything (the per-PR arm is the
// other half of consent — see merge/decide.ts).
export function resolveAutoMerge(repoValue: number | null): boolean {
  if (repoValue !== null) return repoValue === 1;
  return settingValue(SETTINGS.AUTO_MERGE) === "1";
}

export function resolveMergeMethod(repoValue: string | null): MergeMethod {
  if (repoValue && (MERGE_METHODS as readonly string[]).includes(repoValue)) {
    return repoValue as MergeMethod;
  }
  const global = settingValue(SETTINGS.MERGE_METHOD);
  if (global && (MERGE_METHODS as readonly string[]).includes(global)) return global as MergeMethod;
  return "squash";
}

// Auto-refine opt-in, same repo-wins, 0-included shape as resolveAutoMerge.
// Default OFF: commenting on every new issue is noisy enough that it must be
// asked for. Only gates the AUTOMATIC trigger — `/fouine refine` works on any
// enabled repo.
export function resolveRefineEnabled(repoValue: number | null): boolean {
  if (repoValue !== null) return repoValue === 1;
  return settingValue(SETTINGS.REFINE_ENABLED) === "1";
}

export function resolveRefinePrompt(repoPrompt: string | null): string {
  return repoPrompt?.trim() || settingValue(SETTINGS.DEFAULT_REFINE_PROMPT) || DEFAULT_REFINE_PROMPT;
}

// Auto-implement opt-in, same repo-wins, 0-included shape as resolveRefineEnabled.
// Default OFF: a label alone must never start pushing code for someone. Only
// gates the AUTOMATIC trigger (issue labeled) — `/fouine implement` works on
// any enabled repo.
export function resolveImplementEnabled(repoValue: number | null): boolean {
  if (repoValue !== null) return repoValue === 1;
  return settingValue(SETTINGS.IMPLEMENT_ENABLED) === "1";
}

// The label that triggers auto-implement: repo override, then the global
// setting, then the built-in default.
export function resolveImplementLabel(repoValue: string | null): string {
  return repoValue?.trim() || settingValue(SETTINGS.IMPLEMENT_LABEL) || DEFAULT_IMPLEMENT_LABEL;
}

export function resolveImplementPrompt(repoPrompt: string | null): string {
  return (
    repoPrompt?.trim() || settingValue(SETTINGS.DEFAULT_IMPLEMENT_PROMPT) || DEFAULT_IMPLEMENT_PROMPT
  );
}

// Auto-ready opt-in, same repo-wins, 0-included shape as resolveRefineEnabled.
// Default OFF: this only lets the refiner add the implement label itself (via
// mark_issue_ready) once it judges an issue unambiguous. A human adding the
// label always works regardless of this flag. implement_enabled still gates
// the implementer, so auto_ready alone just labels the issue — it never starts
// code being written on its own.
export function resolveAutoReady(repoValue: number | null): boolean {
  if (repoValue !== null) return repoValue === 1;
  return settingValue(SETTINGS.AUTO_READY) === "1";
}

// Refiner model, most-specific-first: per-repo refiner override, then the
// repo's review model override (a repo pinned to a model refines with it),
// then the global refiner default, then the global review default.
export function resolveRefineModel(
  repo: Pick<RepoRow, "refine_model" | "model"> | null | undefined,
): string {
  return (
    repo?.refine_model || repo?.model || settingValue(SETTINGS.REFINE_MODEL) || resolveDefaultModel()
  );
}

// Implementer model, same cascade as resolveRefineModel.
export function resolveImplementModel(
  repo: Pick<RepoRow, "implement_model" | "model"> | null | undefined,
): string {
  return (
    repo?.implement_model ||
    repo?.model ||
    settingValue(SETTINGS.IMPLEMENT_MODEL) ||
    resolveDefaultModel()
  );
}
