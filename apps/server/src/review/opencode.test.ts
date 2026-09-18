import { expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { refineToolEnv, runReview } from "~/review/opencode";

// Minimal client stub: records every prompt sent to the session.
function makeClient(prompts: string[]) {
  return {
    auth: { set: async () => ({ data: true }) },
    session: {
      create: async () => ({ data: { id: "sess" } }),
      prompt: async (req: { body: { parts: { text: string }[] } }) => {
        prompts.push(req.body.parts[0].text);
        return { data: { parts: [{ type: "text", text: `reply ${prompts.length}` }] } };
      },
      messages: async () => ({ data: [] }),
    },
  } as unknown as OpencodeClient;
}

test("refineToolEnv sets FOUINE_READY_LABEL for the mark_issue_ready tool", () => {
  const env = refineToolEnv({
    githubToken: "tok",
    owner: "acme",
    repo: "widget",
    issueNumber: 12,
    reviewId: 1,
    internalUrl: "http://x",
    internalSecret: "s",
    readyLabel: "fouine-ready",
  });
  expect(env.FOUINE_READY_LABEL).toBe("fouine-ready");
  // Unlike improveToolEnv, refineToolEnv keeps FOUINE_PR_NUMBER (set to the
  // issue number) — post_comment posts to /issues/{n}/comments.
  expect(env.FOUINE_PR_NUMBER).toBe("12");
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
  expect(result.text).toBe("reply 1\nreply 2");
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
