// Chart primitives on shadcn/ui charts (Recharts, `components/ui/chart.tsx`).
// Extracted out of the stats route so the chat and /build can draw the same
// charts.
//
// Two rules the whole set relies on. Fixed heights: Recharts fills its parent,
// so a vertical chart's container needs a definite height (h-40/h-32), never a
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
export { LineChart, type LinePoint, DOTS_UP_TO } from "./line-chart";
export { SEVERITY_COLORS, TRIGGER_COLORS } from "./colors";
export { scaleMax } from "./scale";
export { fillOf } from "./recharts-base";
// Rows + column choices → chart props. Pure and shared by the chat tool card
// and the /build registry; see the note at the top of from-rows.ts.
export {
  type Row,
  type BarLayout,
  barLayout,
  capBars,
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
  LONG_LABEL,
  MANY_CATEGORIES,
  MAX_RANKED_BARS,
  MAX_SERIES_BARS,
  type StackedResult,
} from "./from-rows";
