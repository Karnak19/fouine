import { cn } from "@/lib/utils";

const variants: Record<string, { dot: string; pill: string; label?: string }> = {
  pending: { dot: "bg-zinc-500", pill: "bg-zinc-800/60 text-zinc-400 ring-zinc-700/50" },
  running: { dot: "bg-sky-400", pill: "bg-sky-950/40 text-sky-300 ring-sky-800/40" },
  completed: {
    dot: "bg-emerald-400",
    pill: "bg-emerald-950/40 text-emerald-300 ring-emerald-800/40",
    label: "completed",
  },
  failed: { dot: "bg-red-400", pill: "bg-red-950/40 text-red-300 ring-red-800/40" },
};

export function Badge({ status, className }: { status: string; className?: string }) {
  const v = variants[status] ?? variants.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 tabular-nums",
        v.pill,
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          v.dot,
          status === "running" && "animate-[fouine-pulse_1.4s_ease-in-out_infinite]",
        )}
      />
      {v.label ?? status}
    </span>
  );
}
