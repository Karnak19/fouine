// Every chart here is hand-rolled from divs with percentage widths/heights, so
// each one divides by the tallest value in its window. Two things go wrong on
// their own: a window where everything is 0 divides by zero, and an EMPTY
// window makes Math.max() return -Infinity. An empty window is a normal
// outcome, not an error, so the floor keeps the maths finite and the caller
// renders its empty state instead of a NaN.
export const scaleMax = (values: number[]) => Math.max(...values, 0.0001);
