import { test, expect } from "bun:test";
import { automationLevel, presetFlags, type AutomationLevel } from "./automation";

const presets: Exclude<AutomationLevel, "custom">[] = ["off", "review", "review+merge", "autonomous"];

test("each preset round-trips through automationLevel(presetFlags(x))", () => {
  for (const level of presets) {
    expect(automationLevel(presetFlags(level))).toBe(level);
  }
});

test("a mixed combination that matches no preset is custom", () => {
  expect(
    automationLevel({ enabled: 1, auto_merge: 1, refine_enabled: 1, implement_enabled: 0 }),
  ).toBe("custom");
});

test("null flags resolve against globals", () => {
  expect(
    automationLevel(
      { enabled: 1, auto_merge: null, refine_enabled: null, implement_enabled: null },
      { auto_merge: true, refine_enabled: true, implement_enabled: true },
    ),
  ).toBe("autonomous");
  expect(
    automationLevel(
      { enabled: 1, auto_merge: null, refine_enabled: null, implement_enabled: null },
      { auto_merge: false, refine_enabled: false, implement_enabled: false },
    ),
  ).toBe("review");
  // No globals given at all → null resolves to off.
  expect(
    automationLevel({ enabled: 1, auto_merge: null, refine_enabled: null, implement_enabled: null }),
  ).toBe("review");
});
