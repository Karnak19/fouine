import { cn } from "@/lib/utils";

const variants: Record<string, { dot: string; pill: string; label?: string }> = {
  pending: { dot: "bg-zinc-500", pill: "bg-zinc-800/60 text-zinc-400 ring-zinc-700/50" },
  running: { dot: "bg-ember-400", pill: "bg-ember-950/50 text-ember-300 ring-ember-800/40" },
  completed: {
    dot: "bg-emerald-400",
    pill: "bg-emerald-950/40 text-emerald-300 ring-emerald-800/40",
    label: "completed",
  },
  failed: { dot: "bg-red-400", pill: "bg-red-950/40 text-red-300 ring-red-800/40" },
  // Not an outcome — the push carried no diff change, so nothing ran. Muted on
  // purpose: it should read as "nothing to see", not as a result.
  skipped: { dot: "bg-sky-400", pill: "bg-sky-950/40 text-sky-300 ring-sky-800/40" },
};

// Finding severity, same pill shape as the status Badge but without the dot —
// the color alone carries blocking/question/nit, matching the chips that used
// to be hand-rolled in review-detail.tsx.
const SEVERITY_VARIANTS: Record<string, { pill: string; label: string }> = {
  blocking: { pill: "border-red-900/60 bg-red-950/40 text-red-300", label: "blocking" },
  question: { pill: "border-amber-900/60 bg-amber-950/40 text-amber-300", label: "question" },
  nit: { pill: "border-zinc-700 bg-zinc-900 text-zinc-400", label: "nit" },
};

type BadgeProps =
  | { status: string; severity?: never; className?: string }
  | { severity: string; status?: never; className?: string };

export function Badge({ status, severity, className }: BadgeProps) {
  if (severity != null) {
    const v = SEVERITY_VARIANTS[severity] ?? { pill: "border-zinc-700 text-zinc-400", label: severity };
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium",
          v.pill,
          className,
        )}
      >
        {v.label}
      </span>
    );
  }

  const v = variants[status ?? "pending"] ?? variants.pending;
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
