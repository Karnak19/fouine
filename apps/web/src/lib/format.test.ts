import { expect, test } from "bun:test";
import { formatTokens } from "./format";

test("token counts scale through k, M and B at three significant digits", () => {
  expect(formatTokens(null)).toBeNull();
  expect(formatTokens(0)).toBe("0");
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(1000)).toBe("1k");
  expect(formatTokens(1_234)).toBe("1.23k");
  expect(formatTokens(12_345)).toBe("12.3k");
  expect(formatTokens(116_000)).toBe("116k");
  expect(formatTokens(29_128_000)).toBe("29.1M");
  expect(formatTokens(1_500_000_000)).toBe("1.5B");
  expect(formatTokens(2_500_000_000_000)).toBe("2500B");
});

test("rounding up to 1000 of a unit moves to the next one", () => {
  expect(formatTokens(999_950)).toBe("1M");
  expect(formatTokens(999_499)).toBe("999k");
  expect(formatTokens(999_999_999)).toBe("1B");
});
