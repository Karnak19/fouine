// A legend row names the series a chart's colours stand for; the axes carry
// the values. Kept as an inline element so it lays out in a flex-wrap row at
// 390px where a chart-drawn legend would collide.
export function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
