import { expect, test } from "bun:test";
import {
  opencodeSpawnEnv,
  runReview,
  type OpencodeClient,
} from "~/review/opencode";
import type { PermissionRuleset } from "@opencode/client";

// Minimal client stub: records every prompt sent to the session, and answers
// message.list with one assistant message per ask.
function makeClient(prompts: string[]) {
  return {
    integration: { connect: { key: async () => undefined } },
    session: {
      create: async () => ({ id: "sess" }),
      prompt: async (req: { sessionID: string; text: string }) => {
        prompts.push(req.text);
        return { id: `msg-${prompts.length}`, sessionID: req.sessionID, type: "user" };
      },
      wait: async () => undefined,
      get: async () => ({ id: "sess" }),
    },
    message: {
      list: async () => ({
        data: prompts.map((_, i) => ({
          id: `a-${i}`,
          type: "assistant",
          cost: 0.01,
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 0, write: 0 } },
          content: [{ type: "text", text: `reply ${i + 1}` }],
        })),
        cursor: {},
      }),
    },
  } as unknown as OpencodeClient;
}

// The spawned opencode child must inherit ONLY this allowlist. The old spawn
// spread process.env, which handed fouine's GitHub token and app secrets to the
// model's bash.
test("the spawned server inherits only the minimal env allowlist", () => {
  const saved = {
    FOUINE_GITHUB_TOKEN: process.env.FOUINE_GITHUB_TOKEN,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    OPENCODE_BASH_TIMEOUT_MAX_MS: process.env.OPENCODE_BASH_TIMEOUT_MAX_MS,
  };
  process.env.FOUINE_GITHUB_TOKEN = "leak-me";
  process.env.GITHUB_APP_PRIVATE_KEY = "app-secret";
  delete process.env.OPENCODE_BASH_TIMEOUT_MAX_MS;
  try {
    const env = opencodeSpawnEnv("pw", "/cfg/opencode", "http://127.0.0.1:3000");
    expect(Object.keys(env).sort()).toEqual(
      [
        "FOUINE_INTERNAL_URL",
        "HOME",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_SERVER_PASSWORD",
        "PATH",
      ].sort(),
    );
    expect(env.OPENCODE_CONFIG_DIR).toBe("/cfg/opencode");
    expect(env.OPENCODE_SERVER_PASSWORD).toBe("pw");
    expect(env.FOUINE_INTERNAL_URL).toBe("http://127.0.0.1:3000");

    // The one non-secret operator knob is passed through when set …
    process.env.OPENCODE_BASH_TIMEOUT_MAX_MS = "30000";
    expect(opencodeSpawnEnv("pw", "/cfg", "http://x").OPENCODE_BASH_TIMEOUT_MAX_MS).toBe("30000");

    // … but no credential ever rides along — including the optional ones.
    expect(env).not.toContainKey("FOUINE_GITHUB_TOKEN");
    expect(env).not.toContainKey("GITHUB_APP_PRIVATE_KEY");
    expect(env).not.toContainKey("POSTHOG_API_KEY");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("nudges the session once when nothing was posted", async () => {
  const prompts: string[] = [];
  const result = await runReview(makeClient(prompts), {
    directory: "/tmp",
    prompt: "review this",
    model: "zen/kimi-k3",
    hasPosted: () => false,
  });
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("without posting");
  // Whole-session assistant text, so the nudge's answer is appended.
  expect(result.text).toBe("reply 1\nreply 2");
  expect(result.cost).toBeCloseTo(0.02);
  expect(result.tokens).toBe(34);
});

test("does not nudge when the review was posted", async () => {
  const prompts: string[] = [];
  const result = await runReview(makeClient(prompts), {
    directory: "/tmp",
    prompt: "review this",
    model: "zen/kimi-k3",
    hasPosted: () => true,
  });
  expect(prompts).toHaveLength(1);
  expect(result.text).toBe("reply 1");
});

test("creates the session in the review's directory with the parsed model", async () => {
  const calls: unknown[] = [];
  const client = makeClient([]);
  (client.session as unknown as { create: (input: unknown) => Promise<unknown> }).create = async (
    input: unknown,
  ) => {
    calls.push(input);
    return { id: "sess" };
  };
  await runReview(client, { directory: "/worktree", prompt: "go", model: "zen/kimi-k3" });
  expect(calls[0]).toMatchObject({
    title: "fouine review",
    location: { directory: "/worktree" },
    model: { providerID: "zen", id: "kimi-k3" },
  });
});

// Per-review policy rides the session now (not a per-spawn config document):
// session.create must carry the permissions ruleset verbatim.
test("carries the per-session permissions ruleset into session.create", async () => {
  const calls: unknown[] = [];
  const client = makeClient([]);
  (client.session as unknown as { create: (input: unknown) => Promise<unknown> }).create = async (
    input: unknown,
  ) => {
    calls.push(input);
    return { id: "sess" };
  };
  const permissions: PermissionRuleset = [
    { action: "shell", resource: "bun test *", effect: "deny" },
  ];
  await runReview(client, { directory: "/w", prompt: "go", model: "zen/kimi-k3", permissions });
  expect(calls[0]).toMatchObject({ permissions });
});

test("invokes the onSession hook with the created id before prompting", async () => {
  const seen: string[] = [];
  const client = makeClient([]);
  await runReview(
    client,
    { directory: "/tmp", prompt: "go", model: "zen/kimi-k3" },
    { onSession: (id) => void seen.push(id) },
  );
  expect(seen).toEqual(["sess"]);
});
