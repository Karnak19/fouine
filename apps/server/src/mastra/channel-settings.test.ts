import { test, expect, afterEach } from "bun:test";
import { settings, settingValue } from "~/db";
import { createServer } from "~/server/app";
import { SETTINGS } from "~/settings";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setSetting(key: string, value: string): void {
  settings.set.run({ $key: key, $value: value });
  cleanups.push(() => settings.del.run({ $key: key }));
}

test("GET /settings exposes channel wiring but never the tokens or signing secret", async () => {
  setSetting(SETTINGS.CHANNEL_TARGETS, JSON.stringify({ "acme/web": [{ platform: "slack", channel: "C1" }] }));
  setSetting(SETTINGS.CHANNEL_HEALTH, JSON.stringify({ "slack:C1": { failures: 5, disabled: true } }));
  setSetting(SETTINGS.SLACK_BOT_USER_ID, "U1");
  setSetting(SETTINGS.DISCORD_PUBLIC_KEY, "pub");
  setSetting(SETTINGS.DISCORD_APPLICATION_ID, "app");
  setSetting(SETTINGS.SLACK_SIGNING_SECRET, "super-secret");
  setSetting(SETTINGS.SLACK_BOT_TOKEN, "xoxb-secret");
  setSetting(SETTINGS.DISCORD_BOT_TOKEN, "discord-secret");

  const app = await createServer();
  const res = await app.handle(new Request("http://localhost/api/settings"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;

  expect(body.channel_targets).toBe(JSON.stringify({ "acme/web": [{ platform: "slack", channel: "C1" }] }));
  expect(body.channel_health).toBe(JSON.stringify({ "slack:C1": { failures: 5, disabled: true } }));
  expect(body.slack_bot_user_id).toBe("U1");
  expect(body.discord_public_key).toBe("pub");
  expect(body.discord_application_id).toBe("app");
  // The write-only secrets never leave the server.
  expect(body.slack_signing_secret).toBeUndefined();
  expect(body.slack_bot_token).toBeUndefined();
  expect(body.discord_bot_token).toBeUndefined();
});

test("PUT /settings stores channel credentials and wiring through the existing pattern", async () => {
  const app = await createServer();
  const res = await app.handle(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slack_signing_secret: "new-signing-secret",
        slack_bot_token: "xoxb-new",
        slack_bot_user_id: "U2",
        discord_public_key: "pub2",
        discord_bot_token: "discord-new",
        discord_application_id: "app2",
        discord_gateway: "0",
        channel_targets: JSON.stringify({ "acme/api": [{ platform: "discord", channel: "D1" }] }),
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.slack_signing_secret).toBeUndefined();
  expect(body.slack_bot_token).toBeUndefined();
  expect(body.discord_bot_token).toBeUndefined();

  expect(settingValue(SETTINGS.SLACK_SIGNING_SECRET)).toBe("new-signing-secret");
  expect(settingValue(SETTINGS.SLACK_BOT_TOKEN)).toBe("xoxb-new");
  expect(settingValue(SETTINGS.DISCORD_BOT_TOKEN)).toBe("discord-new");
  expect(settingValue(SETTINGS.DISCORD_GATEWAY)).toBe("0");
  expect(JSON.parse(settingValue(SETTINGS.CHANNEL_TARGETS)!)).toEqual({
    "acme/api": [{ platform: "discord", channel: "D1" }],
  });

  for (const key of [
    SETTINGS.SLACK_SIGNING_SECRET,
    SETTINGS.SLACK_BOT_TOKEN,
    SETTINGS.DISCORD_PUBLIC_KEY,
    SETTINGS.DISCORD_BOT_TOKEN,
    SETTINGS.DISCORD_APPLICATION_ID,
    SETTINGS.DISCORD_GATEWAY,
    SETTINGS.CHANNEL_TARGETS,
  ]) {
    cleanups.push(() => settings.del.run({ $key: key }));
  }
});

test("the channel webhook route is public and says 503 when no adapter is configured", async () => {
  const app = await createServer();
  const res = await app.handle(
    new Request("http://localhost/webhook/channels/slack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "url_verification", challenge: "x" }),
    }),
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "slack channel is not configured" });
});
