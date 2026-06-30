type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const env = process.env.LOG_LEVEL as Level | undefined;
  return ORDER[env ?? "info"] ?? ORDER.info;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < minLevel()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

export function errName(err: unknown): string {
  if (err instanceof Error) return err.name;
  return typeof err === "object" && err && "constructor" in err
    ? (err as { constructor: { name: string } }).constructor.name
    : "Error";
}
