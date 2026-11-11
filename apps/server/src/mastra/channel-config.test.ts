import { test, expect, afterEach } from "bun:test";
import { settings } from "~/db";
import { SETTINGS, resolveDiscordChannel, resolveSlackChannel } from "~/settings";
import { config } from "~/config";
import {
  CHANNEL_FAILURE_LIMIT,
  channelKey,
  parseChannelTargets,
  readChannelHealth,
  resolveChannelTargets,
  writeChannelHealth,
} from "~/mastra/channel-config";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setSetting(key: string, value: string): void {
  settings.set.run({ $key: key, $value: value });
  cleanups.push(() => settings.del.run({ $key: key }));
}

function setEnv<K extends keyof typeof config.channels.slack>(
  key: K,
  value: string | undefined,
): void {
  const original = config.channels.slack[key];
  (config.channels.slack as Record<string, unknown>)[key] = value;
  cleanups.push(() => {
    (config.channels.slack as Record<string, unknown>)[key] = original;
  });
}

test("parseChannelTargets accepts the documented shape and drops malformed rows", () => {
  const parsed = parseChannelTargets(
    JSON.stringify({
      "acme/web": [
        { platform: "slack", channel: "C1", enabled: true },
        { platform: "discord", channel: "123" },
        { platform: "teams", channel: "x" },
        { platform: "slack", channel: "" },
        { platform: "slack", channel: "C2", enabled: "yes" },
        "nope",
      ],
      "acme/api": { platform: "slack", channel: "C3" },
      "acme/empty": [],
    }),
  );
  expect(parsed).toEqual({
    "acme/web": [
      { platform: "slack", channel: "C1", enabled: true },
      { platform: "discord", channel: "123" },
    ],
  });
});

test("parseChannelTargets tolerates missing, invalid JSON and non-objects", () => {
  expect(parseChannelTargets(undefined)).toEqual({});
  expect(parseChannelTargets("")).toEqual({});
  expect(parseChannelTargets("not json")).toEqual({});
  expect(parseChannelTargets("[]")).toEqual({});
});

test("resolveChannelTargets reads only the requested repo", () => {
  setSetting(
    SETTINGS.CHANNEL_TARGETS,
    JSON.stringify({
      "acme/web": [{ platform: "slack", channel: "C1" }],
      "acme/api": [{ platform: "discord", channel: "D1" }],
    }),
  );
  expect(resolveChannelTargets("acme/web")).toEqual([{ platform: "slack", channel: "C1" }]);
  expect(resolveChannelTargets("acme/api")).toEqual([{ platform: "discord", channel: "D1" }]);
  expect(resolveChannelTargets("acme/none")).toEqual([]);
});

test("channel health round-trips and fails over to an empty map on bad JSON", () => {
  writeChannelHealth({ "slack:C1": { failures: CHANNEL_FAILURE_LIMIT, disabled: true } });
  expect(readChannelHealth()).toEqual({
    "slack:C1": { failures: CHANNEL_FAILURE_LIMIT, disabled: true },
  });
  settings.set.run({ $key: SETTINGS.CHANNEL_HEALTH, $value: "{" });
  expect(readChannelHealth()).toEqual({});
  settings.del.run({ $key: SETTINGS.CHANNEL_HEALTH });
});

test("a dashboard Slack credential wins over the env fallback; missing pieces mean not configured", () => {
  setEnv("signingSecret", "env-secret");
  setEnv("botToken", "env-token");
  setEnv("botUserId", "UENV");

  expect(resolveSlackChannel()).toEqual({
    signingSecret: "env-secret",
    botToken: "env-token",
    botUserId: "UENV",
  });

  setSetting(SETTINGS.SLACK_SIGNING_SECRET, "dash-secret");
  setSetting(SETTINGS.SLACK_BOT_TOKEN, "dash-token");
  setSetting(SETTINGS.SLACK_BOT_USER_ID, "UDASH");
  expect(resolveSlackChannel()).toEqual({
    signingSecret: "dash-secret",
    botToken: "dash-token",
    botUserId: "UDASH",
  });

  settings.del.run({ $key: SETTINGS.SLACK_SIGNING_SECRET });
  // Signing secret gone: the env fallback is used again, not a broken half-config.
  expect(resolveSlackChannel()?.signingSecret).toBe("env-secret");
});

test("Discord is only configured with all three credentials, and gateway follows the dashboard override", () => {
  setSetting(SETTINGS.DISCORD_PUBLIC_KEY, "pub");
  setSetting(SETTINGS.DISCORD_BOT_TOKEN, "bot");
  setSetting(SETTINGS.DISCORD_APPLICATION_ID, "app");
  expect(resolveDiscordChannel()).toEqual({
    publicKey: "pub",
    botToken: "bot",
    applicationId: "app",
    gateway: true,
  });

  setSetting(SETTINGS.DISCORD_GATEWAY, "0");
  expect(resolveDiscordChannel()?.gateway).toBe(false);
  setSetting(SETTINGS.DISCORD_GATEWAY, "1");
  expect(resolveDiscordChannel()?.gateway).toBe(true);

  settings.del.run({ $key: SETTINGS.DISCORD_BOT_TOKEN });
  expect(resolveDiscordChannel()).toBeNull();
});

test("channelKey is the platform prefix Chat SDK expects on channel ids", () => {
  expect(channelKey({ platform: "slack", channel: "C1" })).toBe("slack:C1");
  expect(channelKey({ platform: "discord", channel: "123" })).toBe("discord:123");
});
