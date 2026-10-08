// What the chat's `codemode` tool hands the dashboard. The server builds these
// (apps/server/src/chat/codemode.ts, chart.ts); the thread renders them.

export type ChartType = "line" | "bar" | "stacked_bar";
export type ChartSpec = { type: ChartType; title: string; x: string; y: string; series?: string };
export type ChartRow = Record<string, string | number | null>;

export type ChartResult =
  | {
      ok: true;
      spec: ChartSpec;
      rows: ChartRow[];
      rowCount: number;
      ms: number;
      note?: string;
    }
  | { ok: false; error: string };

/** One tool call the program made, as the UI shows it in the trace. */
export interface CodemodeCall {
  /** e.g. `stats.query` */
  name: string;
  input: unknown;
  outcome: "success" | "failure" | "interrupted";
  durationMs: number;
  /** Model-safe failure message; only on failure. */
  message?: string;
}

/** The `codemode` tool's output — what the UI gets (the model sees less). */
export type CodemodeOutput =
  | {
      ok: true;
      value: unknown;
      logs: string[];
      truncated: boolean;
      calls: CodemodeCall[];
      charts: Extract<ChartResult, { ok: true }>[];
    }
  | {
      ok: false;
      error: { kind: string; message: string };
      logs: string[];
      truncated: boolean;
      calls: CodemodeCall[];
      charts: Extract<ChartResult, { ok: true }>[];
    };
