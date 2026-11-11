import { settings, settingValue } from "~/db";
import { log } from "~/server/log";
import { SETTINGS } from "~/settings";

/**
 * Per-repo channel wiring, stored as JSON in the existing `settings` table.
 *
 * Shape:
 *   {
 *     "owner/repo": [
 *       { "platform": "slack", "channel": "C012345", "enabled": true },
 *       { "platform": "discord", "channel": "1234567890" }
 *     ]
 *   }
 *
 * `channel` is the platform id, not a URL: a Slack channel id (`C…`) or a
 * Discord channel id. `enabled` defaults to true; a channel auto-disabled by
 * repeated notification failures is tracked separately in CHANNEL_HEALTH, so
 * saving the targets again does not accidentally re-enable a known-bad one.
 */
export type ChannelPlatform = "slack" | "discord";

export interface ChannelTarget {
  platform: ChannelPlatform;
  channel: string;
  enabled?: boolean;
}

export type ChannelTargetMap = Record<string, ChannelTarget[]>;

const PLATFORMS: readonly string[] = ["slack", "discord"];

function isTarget(value: unknown): value is ChannelTarget {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<ChannelTarget>;
  return (
    typeof t.platform === "string" &&
    PLATFORMS.includes(t.platform) &&
    typeof t.channel === "string" &&
    t.channel.trim() !== "" &&
    (t.enabled === undefined || typeof t.enabled === "boolean")
  );
}

/** Parse CHANNEL_TARGETS, dropping malformed rows rather than throwing. */
export function parseChannelTargets(raw: string | undefined): ChannelTargetMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn("channel targets are not valid JSON", { error: String(err) });
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ChannelTargetMap = {};
  for (const [repo, targets] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    const valid = targets.filter(isTarget);
    if (valid.length > 0) out[repo] = valid;
  }
  return out;
}

export function resolveChannelTargets(repo: string): ChannelTarget[] {
  return parseChannelTargets(settingValue(SETTINGS.CHANNEL_TARGETS))[repo] ?? [];
}

/**
 * Consecutive notification failures per channel. Bounded and dashboard-visible:
 * the notification path never retries, and a channel is disabled after
 * FAILURE_LIMIT consecutive failures instead of being hammered on every review.
 */
export const CHANNEL_FAILURE_LIMIT = 5;

export interface ChannelHealth {
  failures: number;
  disabled?: boolean;
  lastError?: string;
  at?: number;
}

export type ChannelHealthMap = Record<string, ChannelHealth>;

export function channelKey(target: Pick<ChannelTarget, "platform" | "channel">): string {
  return `${target.platform}:${target.channel}`;
}

export function readChannelHealth(): ChannelHealthMap {
  const raw = settingValue(SETTINGS.CHANNEL_HEALTH);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ChannelHealthMap)
      : {};
  } catch {
    return {};
  }
}

export function writeChannelHealth(health: ChannelHealthMap): void {
  settings.set.run({ $key: SETTINGS.CHANNEL_HEALTH, $value: JSON.stringify(health) });
}
