import { expect, test } from "bun:test";
import { isAllowedUser } from "~/server/auth";

const allowed = ["karnak19", "octocat"]; // config lowercases these

test("allows a listed user (case-insensitive)", () => {
  expect(isAllowedUser("Karnak19", allowed)).toBe(true);
  expect(isAllowedUser("octocat", allowed)).toBe(true);
});

test("rejects an unlisted user", () => {
  expect(isAllowedUser("stranger", allowed)).toBe(false);
});

test("rejects empty/missing login", () => {
  expect(isAllowedUser("", allowed)).toBe(false);
  expect(isAllowedUser(undefined, allowed)).toBe(false);
});

test("empty allowlist rejects everyone", () => {
  expect(isAllowedUser("karnak19", [])).toBe(false);
});
