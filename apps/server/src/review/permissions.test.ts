import { test, expect } from "bun:test";
import { buildOpencodeConfig } from "~/skills/materialize";
import { reviewOpencodeConfig } from "~/review/permissions";

// v2 permissions are a flat array of { action, resource, effect } — v1 was a
// nested map keyed by action ({ bash: { "npm install": "deny" } }). One entry per
// rule; the last matching rule wins.
type Permission = { action: string; resource: string; effect: string };

const permissionsOf = (cfg: Record<string, unknown>): Permission[] =>
  Array.isArray(cfg.permissions) ? (cfg.permissions as Permission[]) : [];

// Every permission array any builder emits, so the "* deny" checks cover both
// builders and both toggle states. buildOpencodeConfig carries no permissions in
// v2 — the whole policy lives in the per-session review ruleset handed to
// `session.create({ permissions })` (so no cross-source merge order matters) —
// so it drops out here and the review states carry the weight.
const allPermissions = (): Permission[] => [
  ...permissionsOf(buildOpencodeConfig()),
  ...permissionsOf(reviewOpencodeConfig(true)),
  ...permissionsOf(reviewOpencodeConfig(false)),
];

// Documented v2 matching (permissions.ts cites v2's permissions guide): `*` is a
// whole-value wildcard that crosses `/`, and a trailing " *" ALSO matches the
// bare command. v2 now emits only the trailing-* form, so we match here to keep
// asserting the *intent* — an argument-less install is denied — rather than the
// entry spelling v1 used (it listed both forms because the special case was an
// empirical assumption then).
const matches = (resource: string, command: string): boolean => {
  if (resource.endsWith(" *") && command === resource.slice(0, -2)) return true;
  const pattern = resource
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`).test(command);
};

// Last matching shell rule wins, exactly as opencode resolves the array.
const bashEffect = (perms: Permission[], command: string): string | undefined =>
  perms.filter((p) => p.action === "shell" && matches(p.resource, command)).at(-1)?.effect;

const INSTALL_COMMANDS = ["bun install", "npm install", "npm ci", "pnpm install", "yarn add"];
const TEST_COMMANDS = ["bun test", "bunx oxlint", "tsc", "bun run build", "npm test"];

test("bash denies dependency installs but stays allowed by default", () => {
  const perms = permissionsOf(reviewOpencodeConfig(false));

  // A blanket allow must come FIRST, so the later denies win (last match wins).
  expect(perms[0]).toEqual({ action: "shell", resource: "*", effect: "allow" });
  expect(bashEffect(perms, "some-unrelated-command")).toBe("allow");

  // Both the bare and the argument form, so an argument-less install can't slip
  // past on the trailing-" *" special case alone.
  for (const cmd of INSTALL_COMMANDS) {
    expect(bashEffect(perms, cmd)).toBe("deny");
    expect(bashEffect(perms, `${cmd} --save-dev`)).toBe("deny");
  }
});

test("a '*' deny is never emitted (it would strip bash from the model's tools)", () => {
  for (const p of allPermissions()) {
    if (p.resource === "*") expect(p.effect).not.toBe("deny");
  }
});

test("the per-session review ruleset is always non-empty; only its test denies are gated", () => {
  // NOTE: v1 returned `{}` when the toggle was off, leaving the always-on policy
  // to the config dir's opencode.json. v2 deliberately carries the WHOLE policy
  // in the per-session ruleset (so no cross-source merge order matters), so the
  // array is no longer empty — ONLY the test-command denies are toggle-gated.
  // This is a documented v2 design change, not a regression; see the callout in
  // the migration report.
  const off = permissionsOf(reviewOpencodeConfig(false));
  expect(off.length).toBeGreaterThan(0);
  for (const cmd of TEST_COMMANDS) expect(bashEffect(off, cmd)).toBe("allow");
  // The always-on install denies are present even with the toggle off.
  for (const cmd of INSTALL_COMMANDS) expect(bashEffect(off, cmd)).toBe("deny");

  const on = permissionsOf(reviewOpencodeConfig(true));
  // v2's review ruleset now carries the blanket allow itself (v1 leaned on the
  // dir's opencode.json for it); it must still sit before every deny.
  expect(on[0]).toEqual({ action: "shell", resource: "*", effect: "allow" });
  for (const cmd of TEST_COMMANDS) {
    expect(bashEffect(on, cmd)).toBe("deny");
    expect(bashEffect(on, `${cmd} --watch`)).toBe("deny");
  }
  // The only allowed shell resource is the blanket "*"; every specific shell
  // rule is a deny (v1's injection was denies-only; v2's only allow is the
  // blanket that must precede them).
  expect(
    on.filter((p) => p.action === "shell" && p.effect === "allow").map((p) => p.resource),
  ).toEqual(["*"]);
});

test("no builder ever emits a '*' deny, in either toggle state", () => {
  const perms = allPermissions();
  for (const p of perms) {
    if (p.effect === "deny") expect(p.resource).not.toBe("*");
  }
});

test("the blanket allow is first and every deny comes after it", () => {
  const perms = permissionsOf(reviewOpencodeConfig(true));
  expect(perms[0]).toEqual({ action: "shell", resource: "*", effect: "allow" });
  for (const [i, p] of perms.entries()) {
    if (p.effect === "deny") expect(i).toBeGreaterThan(0);
  }
});
