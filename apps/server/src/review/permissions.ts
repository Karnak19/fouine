// Commands the reviewer agent must never run itself. fouine installs the repo's
// dependencies for it (bounded, before the session starts), so an agent-initiated
// install is always either a duplicate or an unbounded network wait — and it was
// a reliable way to burn the whole review budget.
//
// Pattern semantics (opencode v2, documented): whole-value wildcard matching
// where `*` crosses `/`, and a trailing " *" ALSO matches the bare command
// ("yarn *" matches "yarn") — so only the trailing-`*` form of each command is
// listed. Matching is per parsed command node, so `cd /tmp && npm install` is
// checked as two commands and still denied.
//
// ponytail: textual/AST matching, not a sandbox. `sh -c 'npm install'`, `eval`, a
// shell script, or an alias does not decompose into the inner command and slips
// straight through. This stops the model doing the obvious thing, which is the
// actual failure mode; it is not a containment boundary. The container is.
const INSTALL_COMMANDS = [
  "bun install",
  "bun add",
  "bun i",
  "npm install",
  "npm ci",
  "npm add",
  "npm i",
  "pnpm install",
  "pnpm add",
  "pnpm i",
  "yarn",
  "yarn install",
  "yarn add",
];

// Commands the reviewer agent is denied when the deny-test-commands toggle is on
// (global setting, per-repo override). CI already ran these on the same commit,
// and the review worktree usually has no env vars — so a local run mostly
// produces failures that belong to the environment, not the PR, and the agent
// can report them as findings. Same pattern semantics as INSTALL_COMMANDS above:
// trailing-`*` form only, since v2 documents that it also matches the bare
// command.
const TEST_COMMANDS = [
  "bun test",
  "bun run test",
  "bun run build",
  "bun run lint",
  "bun run typecheck",
  "bunx vitest",
  "bunx oxlint",
  "bunx tsc",
  "vitest",
  "oxlint",
  "eslint",
  "jest",
  "tsc",
  "npx vitest",
  "npx eslint",
  "npx jest",
  "npx tsc",
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm lint",
  "pnpm typecheck",
  "yarn test",
  "yarn build",
  "yarn lint",
  "yarn typecheck",
];

// The per-review permission ruleset, handed to `session.create({ permissions })`
// when the manager opens each review's session on the shared server. The static
// config document in the seeded OPENCODE_CONFIG_DIR (buildOpencodeConfig in
// skills/materialize.ts) carries no permission rules at all, so this array is
// the WHOLE policy — there is no second source and therefore no cross-source
// merge order to reason about.
//
// Ordering inside the array still matters: the blanket allows are written first
// and the denies after them. A "*" shell DENY must never appear (opencode drops
// the shell tool from the model's tool list entirely, leaving the reviewer
// unable to run anything). Denylist of specific patterns, always.
export function reviewOpencodeConfig(denyTestCommands: boolean): Record<string, unknown> {
  const permissions: Array<{ action: string; resource: string; effect: string }> = [
    { action: "shell", resource: "*", effect: "allow" },
    // Self-hosted, single-operator: whoever installs a skill owns the box, so
    // there's no third party to gate against — allow the skill action outright.
    { action: "skill", resource: "*", effect: "allow" },
  ];
  for (const cmd of INSTALL_COMMANDS) {
    permissions.push({ action: "shell", resource: `${cmd} *`, effect: "deny" });
  }
  if (denyTestCommands) {
    for (const cmd of TEST_COMMANDS) {
      permissions.push({ action: "shell", resource: `${cmd} *`, effect: "deny" });
    }
  }
  // The v2 default policy asks before external-directory access and .env reads;
  // a headless review has no client to answer an ask, so an unanswered ask would
  // stall the tool call until the watchdog kills the review. Allow both — the
  // container, not opencode, is the containment boundary (same ponytail
  // rationale as the install denies above).
  permissions.push(
    { action: "external_directory", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "allow" },
    { action: "read", resource: "*.env.*", effect: "allow" },
  );
  return { permissions };
}
