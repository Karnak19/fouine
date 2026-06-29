import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  pending: "bg-zinc-800 text-zinc-400",
  running: "bg-blue-900/50 text-blue-400",
  completed: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
};

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variants[status] ?? variants.pending,
        className,
      )}
    >
      {status}
    </span>
  );
}
