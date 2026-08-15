import { expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { runReview } from "~/review/opencode";

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
