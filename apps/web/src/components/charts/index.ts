// Hand-rolled chart primitives — divs with percentage widths and heights, no
// charting library anywhere in this app. Extracted out of the stats route so
// the chat can draw the same charts inside a thread.
//
// Two rules the whole set relies on. Fixed heights: bar heights are
// percentages, so the container needs a definite height (h-40/h-32), never a
// min-h. And three states, always: `!rows` → PanelSkeleton, `rows.length === 0`
// → PanelEmpty, else the chart.
export { Panel, PanelSkeleton, PanelEmpty } from "./panel";
export { LegendDot } from "./legend";
export { MixBar, type MixBarItem } from "./mix-bar";
export {
  BarChart,
  StackedBarChart,
  type BarChartBar,
  type StackedBar,
  type StackedBarSegment,
} from "./bar-chart";
export { SEVERITY_COLORS, TRIGGER_COLORS } from "./colors";
export { scaleMax } from "./scale";
