// The tallest value in a window, floored so the maths stays finite: a window
// where everything is 0 divides by zero, and an EMPTY window makes Math.max()
// return -Infinity. An empty window is a normal outcome, not an error. The
// Recharts charts scale themselves; this remains for the hand-sized lists in
// the stats route (files with the most findings, latency trend).
export const scaleMax = (values: number[]) => Math.max(...values, 0.0001);
