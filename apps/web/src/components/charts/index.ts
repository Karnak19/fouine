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
export { LineChart, type LinePoint } from "./line-chart";
export { SEVERITY_COLORS, TRIGGER_COLORS } from "./colors";
export { scaleMax } from "./scale";
// Rows + column choices → chart props. Pure and shared by the chat tool card
// and the /build registry; see the note at the top of from-rows.ts.
export {
  type Row,
  categoriesOf,
  formatValue,
  label,
  mixFromRows,
  num,
  pointsFromRows,
  rankSeries,
  seriesColor,
  stackedFromRows,
  totalsByCategory,
  type StackedResult,
} from "./from-rows";
// The label strip that stands in for an x axis, shared by the chat chart card
// and the /build registry.
export { CategoryAxis, LABELS_FIT } from "./category-axis";
