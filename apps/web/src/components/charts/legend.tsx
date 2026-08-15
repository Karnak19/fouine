// There are no axes anywhere in these charts — a legend row and a caption row
// carry the meaning instead, which keeps a chart readable at 390px where axis
// labels would collide.
export function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
