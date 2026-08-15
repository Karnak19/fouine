export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts * 1000) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function duration(start: number, end: number | null): string {
  const secs = Math.floor((end ?? Date.now() / 1000) - start);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return `${m}m ${secs % 60}s`;
}

const TRIGGER_LABELS: Record<string, string> = {
  opened: "opened",
  synchronize: "push",
  reopened: "reopened",
  command: "/review",
  retry: "retry",
};

export function triggerLabel(trigger: string | null): string | null {
  if (!trigger) return null;
  return TRIGGER_LABELS[trigger] ?? trigger;
}

export function formatCost(cost: number | null): string | null {
  if (cost == null) return null;
  return `$${cost.toFixed(4)}`;
}

// Formats a raw second count (e.g. an averaged duration) — distinct from
// `duration`, which takes start/end timestamps.
export function formatSeconds(secs: number | null): string | null {
  if (secs == null) return null;
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTokens(tokens: number | null): string | null {
  if (tokens == null) return null;
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}
