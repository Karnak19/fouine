import { useEffect, useRef, useState } from "react";
import type { RepoRow, ReviewRow } from "./api";

// Client side of the /api/events SSE stream. One EventSource per scope,
// refcounted across pages (dashboard + reviews share scope "*"; each repo page
// opens its own scope). Events never carry data the client trusts blindly —
// they only trigger react-query invalidations, so the REST queries stay the
// source of truth (initial snapshot + fallback when the stream is down).

// Mirrors TranscriptDelta / TranscriptPart in apps/server/src/review/transcript.ts.
// Already truncated and coalesced server-side; the client just merges by id.
export interface TranscriptPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string; output?: string; error?: string };
}
export interface TranscriptDelta {
  messageId: string;
  role?: string;
  part?: TranscriptPart;
}

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline" | "error";

export type ServerEvent =
  | { type: "review:created"; repo: string; review: ReviewRow }
  | { type: "review:updated"; repo: string; review: ReviewRow }
  | { type: "review:findings"; repo: string; reviewId: number }
  | { type: "review:transcript"; repo: string; reviewId: number; delta: TranscriptDelta }
  | { type: "repo:updated"; repo: string; row: RepoRow }
  | { type: "repo:removed"; repo: string }
  | { type: "webhook:received"; repo: string | null; name: string; delivery: string };

interface Conn {
  es: EventSource;
  refs: number;
  status: LiveStatus;
  listeners: Set<{ current: (e: ServerEvent) => void }>;
  statusListeners: Set<(s: LiveStatus) => void>;
  resync: number;
}

const conns = new Map<string, Conn>();

function acquire(key: string, scope: string | null): Conn {
  let conn = conns.get(key);
  if (conn) return conn;
  const es = new EventSource(`/api/events${scope ? `?repo=${encodeURIComponent(scope)}` : ""}`);
  conn = {
    es,
    refs: 0,
    status: "connecting",
    listeners: new Set(),
    statusListeners: new Set(),
    resync: 0,
  };
  conns.set(key, conn);
  es.onopen = () => {
    // Reconnecting -> live means the browser dropped us and came back: the
    // server sent nothing meanwhile (no replay), so pages refetch to resync.
    const prev = conn!.status;
    conn!.status = "live";
    if (prev === "reconnecting" || prev === "offline" || prev === "error") conn!.resync++;
    conn!.statusListeners.forEach((l) => l("live"));
  };
  es.onerror = () => {
    const next: LiveStatus = navigator.onLine ? "reconnecting" : "offline";
    conn!.status = next;
    conn!.statusListeners.forEach((l) => l(next));
  };
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const e = JSON.parse(ev.data) as ServerEvent;
      conn!.listeners.forEach((l) => l.current(e));
    } catch {
      // malformed frame — ignore, next heartbeat/event will resync
    }
  };
  return conn;
}

// Subscribe a page to live events. `onEvent` should invalidate the page's
// react-query keys. `resync` increments each time the connection comes back
// after a drop — bump it in a useEffect to refetch everything on reconnect.
export function useLiveEvents(
  scope: string | null,
  onEvent: (e: ServerEvent) => void,
): { status: LiveStatus; resync: number } {
  const key = scope ?? "*";
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [resync, setResync] = useState(0);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const conn = acquire(key, scope);
    conn.refs++;
    conn.listeners.add(handler);
    const onStatus = (s: LiveStatus) => setStatus(s);
    conn.statusListeners.add(onStatus);
    setStatus(conn.status);
    return () => {
      conn.listeners.delete(handler);
      conn.statusListeners.delete(onStatus);
      conn.refs--;
      if (conn.refs === 0) {
        conn.es.close();
        conns.delete(key);
      }
    };
  }, [key, scope]);

  const prev = useRef<LiveStatus>("connecting");
  useEffect(() => {
    if (
      (prev.current === "reconnecting" || prev.current === "offline" || prev.current === "error") &&
      status === "live"
    ) {
      setResync((n) => n + 1);
    }
    prev.current = status;
  }, [status]);

  return { status, resync };
}
