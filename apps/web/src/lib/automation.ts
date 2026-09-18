import type { RepoRow } from "@fouine/shared";

// ponytail: derived from the five flags, no `mode` column — the API and DB
// stay the source of truth. Upgrade path if a sixth flag shows up: extend
// presetFlags/automationLevel together, don't add a stored mode.
export type AutomationLevel = "off" | "review" | "review+merge" | "autonomous" | "custom";

type Flags = {
  enabled: number;
  auto_merge: number;
  refine_enabled: number;
  implement_enabled: number;
  auto_ready: number;
};

export function presetFlags(level: Exclude<AutomationLevel, "custom">): Flags {
  switch (level) {
    case "off":
      return { enabled: 0, auto_merge: 0, refine_enabled: 0, implement_enabled: 0, auto_ready: 0 };
    case "review":
      return { enabled: 1, auto_merge: 0, refine_enabled: 0, implement_enabled: 0, auto_ready: 0 };
    case "review+merge":
      return { enabled: 1, auto_merge: 1, refine_enabled: 0, implement_enabled: 0, auto_ready: 0 };
    case "autonomous":
      return { enabled: 1, auto_merge: 1, refine_enabled: 1, implement_enabled: 1, auto_ready: 1 };
  }
}

export function automationLevel(
  repo: Pick<RepoRow, "enabled" | "auto_merge" | "refine_enabled" | "implement_enabled" | "auto_ready">,
  globals?: {
    auto_merge: boolean;
    refine_enabled: boolean;
    implement_enabled: boolean;
    auto_ready: boolean;
  },
): AutomationLevel {
  const resolve = (value: number | null, global: boolean | undefined): number =>
    value !== null ? value : global ? 1 : 0;
  const flags: Flags = {
    enabled: repo.enabled === 1 ? 1 : 0,
    auto_merge: resolve(repo.auto_merge, globals?.auto_merge),
    refine_enabled: resolve(repo.refine_enabled, globals?.refine_enabled),
    implement_enabled: resolve(repo.implement_enabled, globals?.implement_enabled),
    auto_ready: resolve(repo.auto_ready, globals?.auto_ready),
  };
  // Both literals are built in this file with the same key order, so string
  // equality is flag equality.
  return (
    AUTOMATION_LEVELS.find((l) => JSON.stringify(presetFlags(l.value)) === JSON.stringify(flags))
      ?.value ?? "custom"
  );
}

export const AUTOMATION_LEVELS: {
  value: Exclude<AutomationLevel, "custom">;
  label: string;
  hint: string;
}[] = [
  { value: "off", label: "Off", hint: "Does nothing on this repo. Slash commands still work." },
  { value: "review", label: "Review", hint: "Reviews PRs. Never merges, never touches issues." },
  {
    value: "review+merge",
    label: "Review + merge",
    hint: "Reviews PRs and merges them once fouine approved and CI is green.",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    hint: "Reviews and merges PRs, refines new issues, marks them ready itself when clear, then implements them.",
  },
];
