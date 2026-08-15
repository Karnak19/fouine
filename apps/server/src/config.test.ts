import { expect, test } from "bun:test";
import { durationMs } from "~/config";

const FALLBACK = 300_000;

test("uses the value when it is a positive finite number", () => {
  expect(durationMs("1000", FALLBACK)).toBe(1000);
  expect(durationMs("0.5", FALLBACK)).toBe(0.5);
});

test("falls back when the variable is unset or blank", () => {
  expect(durationMs(undefined, FALLBACK)).toBe(FALLBACK);
  // `??` would NOT catch these — Number("") is 0, which would mean "kill every
  // review instantly" rather than "use the default".
  expect(durationMs("", FALLBACK)).toBe(FALLBACK);
  expect(durationMs("   ", FALLBACK)).toBe(FALLBACK);
});

// The dangerous direction: NaN makes every `elapsed > timeout` comparison false,
// which silently disables the watchdog while the config still looks set.
test.each(["oops", "NaN", "12ms", "Infinity", "-Infinity", "0", "-1"])(
  "falls back for the invalid value %p",
  (raw) => {
    expect(durationMs(raw, FALLBACK)).toBe(FALLBACK);
  },
);
