import * as stylex from "@stylexjs/stylex";
import { color, leading, radius, space, text } from "@/tokens.stylex";
import type { LiveStatus } from "@/lib/live";

const s = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs,
    fontVariantNumeric: "tabular-nums"
  },
  dot: {
    height: space.x6,
    width: space.x6,
    borderRadius: radius.full
  },
  warnText: { color: color.warnText },
  warnDot: { backgroundColor: color.warnDot },
  okText: { color: color.okText },
  okDot: { backgroundColor: color.okDot },
  offText: { color: color.zinc400 },
  offDot: { backgroundColor: color.zinc500 },
  dangerText: { color: color.dangerText },
  dangerDot: { backgroundColor: color.dangerDot },
  pulse: {
    animationName: "fouine-pulse",
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite"
  }
});

const META: Record<LiveStatus, { label: string; text: stylex.StyleXStyles; dot: stylex.StyleXStyles }> = {
  connecting: { label: "connecting", text: s.warnText, dot: s.warnDot },
  live: { label: "live", text: s.okText, dot: s.okDot },
  reconnecting: { label: "reconnecting…", text: s.warnText, dot: [s.warnDot, s.pulse] },
  offline: { label: "offline", text: s.offText, dot: s.offDot },
  error: { label: "connection error", text: s.dangerText, dot: s.dangerDot }
};

export function LiveBadge({ status }: { status: LiveStatus }) {
  const m = META[status];
  return (
    <span {...stylex.props(s.root, m.text)} title={`Live events: ${m.label}`}>
      <span {...stylex.props(s.dot, m.dot)} />
      {m.label}
    </span>
  );
}
