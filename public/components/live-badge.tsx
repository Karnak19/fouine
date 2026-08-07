import type { LiveStatus } from "@/lib/live";

const META: Record<LiveStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: "connecting", dot: "bg-amber-400", text: "text-amber-300" },
  live: { label: "live", dot: "bg-emerald-400", text: "text-emerald-300" },
  reconnecting: { label: "reconnecting…", dot: "bg-amber-400 animate-pulse", text: "text-amber-300" },
  offline: { label: "offline", dot: "bg-zinc-500", text: "text-zinc-400" },
  error: { label: "connection error", dot: "bg-red-400", text: "text-red-300" },
};

export function LiveBadge({ status }: { status: LiveStatus }) {
  const m = META[status];
  return (
    <span
      className={`flex items-center gap-1.5 text-xs tabular-nums ${m.text}`}
      title={`Live events: ${m.label}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
