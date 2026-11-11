import { test, expect, beforeAll, afterAll } from "bun:test";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import type { ChannelHandler } from "@mastra/core/channels";
import { MAX_QUESTION_CHARS } from "~/chat";
import { mastra } from "~/mastra";
import { channelAgent, channelRenderChartTool } from "~/mastra/channel-agent";
import {
  buildChannelRuntime,
  channelHandlers,
  handleChannelWebhook,
  type ChannelRuntime,
} from "~/mastra/channels";

// The channel agent answers with the same scripted model as the chat smoke, so
// these tests exercise the real Mastra Channels pipeline (webhook → adapter →
// agent → platform post) without an API key. The platform API itself is a
// loopback Bun server; no external network is touched.
process.env.CHAT_MOCK = "1";
const SLACK_SECRET = "test-signing-secret";
const SLACK_CHANNEL = "C1";
const SLACK_THREAD_TS = "1234.5678";

interface ApiCall {
  method: string;
  path: string;
  body: string;
}

let slackApi: ReturnType<typeof Bun.serve>;
let slackCalls: ApiCall[] = [];

beforeAll(() => {
  slackApi = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text().catch(() => "");
      slackCalls.push({ method: req.method, path: url.pathname, body });
      if (url.pathname.endsWith("/users.info")) {
        return Response.json({
          ok: true,
          user: { id: "U1", name: "u1", profile: { display_name: "Tester" } },
        });
      }
      if (url.pathname.endsWith("/conversations.replies")) {
        return Response.json({ ok: true, messages: [] });
      }
      return Response.json({ ok: true, ts: "111.222", channel: SLACK_CHANNEL });
    },
  });
  // The Slack adapter reads these at construction time.
  process.env.SLACK_API_URL = `http://127.0.0.1:${slackApi.port}/api/`;
});

afterAll(() => {
  slackApi.stop(true);
  delete process.env.SLACK_API_URL;
  delete process.env.DISCORD_API_URL;
  delete process.env.CHAT_MOCK;
});

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) return false;
    await Bun.sleep(50);
  }
  return true;
}

function slackRuntime(): Promise<ChannelRuntime | null> {
  return buildChannelRuntime(
    { slack: { signingSecret: SLACK_SECRET, botToken: "xoxb-test", botUserId: "U0BOT" } },
    mastra,
  );
}

function signedSlack(body: string): Headers {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "v0=" + createHmac("sha256", SLACK_SECRET).update(`v0:${timestamp}:${body}`).digest("hex");
  return new Headers({
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  });
}

function slackMention(ts: string, text = "<@U0BOT> how many reviews?"): string {
  return JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event_id: `Ev-${ts}`,
    event_time: Math.floor(Date.now() / 1000),
    event: {
      type: "app_mention",
      user: "U1",
      text,
      ts,
      event_ts: ts,
      channel: SLACK_CHANNEL,
      channel_type: "channel",
    },
  });
}

test("a Slack webhook with no or a bad signature is rejected before the agent", async () => {
  const runtime = await slackRuntime();
  expect(runtime).not.toBeNull();

  const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
  const missing = await handleChannelWebhook(
    "slack",
    new Request("http://localhost/webhook/channels/slack", { method: "POST", body }),
    runtime,
  );
  expect(missing.status).toBe(401);

  const bad = await handleChannelWebhook(
    "slack",
    new Request("http://localhost/webhook/channels/slack", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-slack-signature": "v0=deadbeef", "x-slack-request-timestamp": "1" },
    }),
    runtime,
  );
  expect(bad.status).toBe(401);
});

test("an unknown platform is refused, and a configured runtime only accepts its own adapters", async () => {
  const runtime = await slackRuntime();
  const unknown = await handleChannelWebhook(
    "teams",
    new Request("http://localhost/webhook/channels/teams", { method: "POST" }),
    runtime,
  );
  expect(unknown.status).toBe(404);

  const notConfigured = await handleChannelWebhook(
    "discord",
    new Request("http://localhost/webhook/channels/discord", { method: "POST" }),
    runtime,
  );
  expect(notConfigured.status).toBe(503);
});

test("a well-signed Slack mention produces an agent answer in the same thread", async () => {
  const runtime = await slackRuntime();
  expect(runtime).not.toBeNull();
  slackCalls = [];

  const body = slackMention(SLACK_THREAD_TS);
  const res = await handleChannelWebhook(
    "slack",
    new Request("http://localhost/webhook/channels/slack", {
      method: "POST",
      body,
      headers: signedSlack(body),
    }),
    runtime,
  );
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");

  const posted = await waitFor(() =>
    slackCalls.some(
      (call) =>
        call.path.endsWith("/chat.postMessage") &&
        new URLSearchParams(call.body).get("markdown_text")?.includes("Here is what") === true,
    ),
  );
  expect(posted).toBe(true);

  const post = slackCalls.find(
    (call) =>
      call.path.endsWith("/chat.postMessage") &&
      new URLSearchParams(call.body).get("markdown_text")?.includes("Here is what") === true,
  )!;
  const params = new URLSearchParams(post.body);
  // Answers go back to the thread the question came from.
  expect(params.get("thread_ts")).toBe(SLACK_THREAD_TS);
  expect(params.get("channel")).toBe(SLACK_CHANNEL);
}, 30_000);

test("the platform thread is mapped deterministically to the Mastra thread and remembered", async () => {
  const memory = await channelAgent.getMemory();
  expect(memory).toBeDefined();
  const threadId = `slack:${SLACK_CHANNEL}:${SLACK_THREAD_TS}`;

  const found = await waitForAsync(async () => {
    const thread = await memory!.getThreadById({ threadId });
    return thread !== null;
  });
  expect(found).toBe(true);

  const thread = await memory!.getThreadById({ threadId });
  expect(thread?.id).toBe(threadId);
  expect(thread?.resourceId).toBe("slack:U1");
});

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) return false;
    await Bun.sleep(50);
  }
  return true;
}

test("an over-long channel turn is refused in-thread without calling the model", async () => {
  const handler = channelHandlers.onMention as ChannelHandler;
  const posted: string[] = [];
  let ran = false;
  await handler(
    { post: async (text: string) => void posted.push(text) } as never,
    { text: "x".repeat(MAX_QUESTION_CHARS + 1) } as never,
    (async () => {
      ran = true;
    }) as never,
    {} as never,
  );
  expect(ran).toBe(false);
  expect(posted).toEqual([`Question too long — keep it under ${MAX_QUESTION_CHARS} characters.`]);
});

test("the channel registry is read-only: only the four read tools exist", async () => {
  const tools = Object.keys(await channelAgent.listTools()).sort();
  expect(tools).toEqual(["ask_chat", "list_repos", "query_stats", "render_chart"]);
  expect(tools).not.toContain("start_review");
  expect(tools).not.toContain("post_comment");
  expect(tools).not.toContain("merge_pr");
});

test("render_chart degrades to a text table on channels", async () => {
  const output = (await channelRenderChartTool.execute!(
    {
      sql: "SELECT 'completed' AS status, 2 AS reviews UNION ALL SELECT 'failed', 1",
      type: "bar",
      title: "Reviews by status",
      x: "status",
      y: "reviews",
    },
    { abortSignal: undefined } as never,
  )) as string;
  expect(output).toContain("Reviews by status (bar)");
  expect(output).toContain("status=completed, reviews=2");
  expect(output).toContain("Charts cannot be drawn in chat channels");
});

test("Discord verifies Ed25519 and only lets a signed interaction through", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(
    publicKey.export({ type: "spki", format: "der" }).subarray(-32),
  ).toString("hex");

  const calls: ApiCall[] = [];
  const discordApi = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.arrayBuffer().then((buf) => new TextDecoder().decode(buf)).catch(() => "");
      calls.push({ method: req.method, path: url.pathname, body });
      if (url.pathname.endsWith("/users/@me")) {
        return Response.json({ id: "123", username: "fouine", discriminator: "0001" });
      }
      return Response.json({
        id: "MSG1",
        channel_id: "C1",
        content: "ok",
        timestamp: new Date().toISOString(),
      });
    },
  });
  process.env.DISCORD_API_URL = `http://127.0.0.1:${discordApi.port}/api/v10`;

  const runtime = await buildChannelRuntime(
    {
      discord: {
        publicKey: publicKeyHex,
        botToken: "discord-test",
        applicationId: "123456789012345678",
        gateway: false,
      },
    },
    mastra,
  );
  expect(runtime).not.toBeNull();

  const body = JSON.stringify({ id: "INT1", application_id: "123456789012345678", type: 1 });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  const headers = {
    "content-type": "application/json",
    "x-signature-ed25519": signature,
    "x-signature-timestamp": timestamp,
  };

  const bad = await handleChannelWebhook(
    "discord",
    new Request("http://localhost/webhook/channels/discord", {
      method: "POST",
      body,
      headers: { ...headers, "x-signature-ed25519": "00" },
    }),
    runtime,
  );
  expect(bad.status).toBe(401);

  const ping = await handleChannelWebhook(
    "discord",
    new Request("http://localhost/webhook/channels/discord", { method: "POST", body, headers }),
    runtime,
  );
  expect(ping.status).toBe(200);
  expect(await ping.json()).toEqual({ type: 1 });

  // The agent reply path (slash command → deferred interaction → channel post)
  // is exercised too. The adapter hardcodes discord.com for the interaction
  // follow-up, so intercept that one URL; channel posts go to the loopback
  // DISCORD_API_URL above.
  const realFetch = globalThis.fetch;
  const interactionCalls: ApiCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://discord.com/api/v10/webhooks/")) {
      interactionCalls.push({
        method: init?.method ?? "GET",
        path: url,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return Response.json({
        id: "MSG1",
        channel_id: "C1",
        content: "ok",
        timestamp: new Date().toISOString(),
      });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;

  try {
    const slashBody = JSON.stringify({
      id: "INT2",
      application_id: "123456789012345678",
      type: 2,
      data: {
        id: "CMD1",
        name: "fouine",
        type: 1,
        options: [{ name: "question", type: 3, value: "how many reviews?" }],
      },
      guild_id: "G1",
      channel_id: "C1",
      member: {
        user: { id: "U1", username: "tester", discriminator: "0", global_name: "Tester" },
        roles: [],
        permissions: "0",
      },
      token: "TOKEN1",
      version: 1,
    });
    const slashTimestamp = String(Math.floor(Date.now() / 1000));
    const slashSignature = sign(
      null,
      Buffer.from(slashTimestamp + slashBody),
      privateKey,
    ).toString("hex");

    const slash = await handleChannelWebhook(
      "discord",
      new Request("http://localhost/webhook/channels/discord", {
        method: "POST",
        body: slashBody,
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": slashSignature,
          "x-signature-timestamp": slashTimestamp,
        },
      }),
      runtime,
    );
    expect(slash.status).toBe(200);
    expect(await slash.json()).toEqual({ type: 5 });

    // A slash command answers through the interaction webhook (the adapter's
    // hardcoded discord.com URL, stubbed above); tool cards and the final
    // answer are both PATCHes to `messages/@original`.
    const answered = await waitFor(() => interactionCalls.some((call) => call.body.includes("Here is what")));
    expect(answered).toBe(true);
    expect(interactionCalls.some((call) => call.method === "PATCH")).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
    discordApi.stop(true);
    delete process.env.DISCORD_API_URL;
  }
}, 30_000);
