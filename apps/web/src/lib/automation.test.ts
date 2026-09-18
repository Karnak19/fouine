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
    automationLevel({
      enabled: 1,
      auto_merge: 1,
      refine_enabled: 1,
      implement_enabled: 0,
      auto_ready: 0,
    }),
  ).toBe("custom");
});

test("autonomous requires auto_ready on, otherwise custom", () => {
  expect(
    automationLevel({
      enabled: 1,
      auto_merge: 1,
      refine_enabled: 1,
      implement_enabled: 1,
      auto_ready: 0,
    }),
  ).toBe("custom");
  expect(
    automationLevel(
      { enabled: 1, auto_merge: 1, refine_enabled: 1, implement_enabled: 1, auto_ready: null },
      { auto_merge: true, refine_enabled: true, implement_enabled: true, auto_ready: false },
    ),
  ).toBe("custom");
});

test("review and review+merge still match with auto_ready off", () => {
  expect(
    automationLevel({
      enabled: 1,
      auto_merge: 0,
      refine_enabled: 0,
      implement_enabled: 0,
      auto_ready: 0,
    }),
  ).toBe("review");
  expect(
    automationLevel({
      enabled: 1,
      auto_merge: 1,
      refine_enabled: 0,
      implement_enabled: 0,
      auto_ready: 0,
    }),
  ).toBe("review+merge");
});

test("null flags resolve against globals", () => {
  expect(
    automationLevel(
      { enabled: 1, auto_merge: null, refine_enabled: null, implement_enabled: null, auto_ready: null },
      { auto_merge: true, refine_enabled: true, implement_enabled: true, auto_ready: true },
    ),
  ).toBe("autonomous");
  expect(
    automationLevel(
      { enabled: 1, auto_merge: null, refine_enabled: null, implement_enabled: null, auto_ready: null },
      { auto_merge: false, refine_enabled: false, implement_enabled: false, auto_ready: false },
    ),
  ).toBe("review");
  // No globals given at all → null resolves to off.
  expect(
    automationLevel({
      enabled: 1,
      auto_merge: null,
      refine_enabled: null,
      implement_enabled: null,
      auto_ready: null,
    }),
  ).toBe("review");
});

test("global auto_ready on with repo override null counts as on", () => {
  expect(
    automationLevel(
      { enabled: 1, auto_merge: 1, refine_enabled: 1, implement_enabled: 1, auto_ready: null },
      { auto_merge: true, refine_enabled: true, implement_enabled: true, auto_ready: true },
    ),
  ).toBe("autonomous");
});
