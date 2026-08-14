import { test, expect, afterEach } from "bun:test";
import { buildOpencodeConfig } from "~/skills/materialize";

const original = process.env.POSTHOG_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.POSTHOG_API_KEY;
  else process.env.POSTHOG_API_KEY = original;
});

test("the PostHog plugin is declared only when an API key is set", () => {
  delete process.env.POSTHOG_API_KEY;
  expect(buildOpencodeConfig().plugin).toBeUndefined();

  process.env.POSTHOG_API_KEY = "phc_test";
  expect(buildOpencodeConfig().plugin).toEqual(["@posthog/opencode"]);
});

test("bash denies dependency installs but stays allowed by default", () => {
  const bash = (buildOpencodeConfig().permission as { bash: Record<string, string> }).bash;

  // A blanket allow must come FIRST, so the later denies win (last match wins).
  expect(Object.keys(bash)[0]).toBe("*");
  expect(bash["*"]).toBe("allow");

  // Both the bare and the trailing-* form, so we don't depend on opencode's
  // trailing-" *" special case to catch an argument-less install.
  for (const cmd of ["bun install", "npm install", "npm ci", "pnpm install", "yarn add"]) {
    expect(bash[cmd]).toBe("deny");
    expect(bash[`${cmd} *`]).toBe("deny");
  }
});

test("a '*' deny is never emitted (it would strip bash from the model's tools)", () => {
  const perms = buildOpencodeConfig().permission as Record<string, Record<string, string>>;
  for (const table of Object.values(perms)) {
    expect(table["*"]).not.toBe("deny");
  }
});
