import {
  referencedDatasetKeys,
  toPreviousDataset,
  type BuildDataset,
  type BuildPrevious,
  type SanitizedSpec,
} from "@fouine/shared/build-catalog";

// What the page sends back up when the next prompt should EDIT the dashboard
// rather than replace it. Pure on purpose, so the test can pin down the two
// properties that matter: the spec that goes up is the sanitised one (never
// what the model emitted), and no dataset carries rows — only the SQL, which
// the server re-runs through its own guard.

/**
 * Build the `previous` body from the dashboard as rendered.
 *
 * Datasets the spec no longer references are dropped here, so a chart removed
 * two refinements ago does not keep its query alive in every request after.
 * Order follows the spec's elements, which is also the order the SQL
 * disclosure lists them in.
 */
export function previousFromDashboard(
  spec: SanitizedSpec["spec"],
  datasets: Record<string, BuildDataset>,
  prompts: readonly string[],
): BuildPrevious {
  const used = referencedDatasetKeys(spec);
  return {
    spec,
    datasets: used.flatMap((k) => {
      const d = datasets[k];
      return d ? [toPreviousDataset(d)] : [];
    }),
    prompts: [...prompts],
  };
}

/**
 * The 400 body from /api/build is `{"error": "..."}`; the AI SDK transport
 * throws it as the raw text. Show the message, not the JSON around it.
 */
export function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON — a network error, or a message written for humans already.
  }
  return error.message;
}
