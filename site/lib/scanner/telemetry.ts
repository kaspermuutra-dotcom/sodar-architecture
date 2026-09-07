/**
 * Structured, privacy-conscious scanner events. Never image contents, keys,
 * signed URLs, or personal data — only event names, ids, counts and durations.
 * Events are buffered locally and flushed with `sendBeacon` so leaving the
 * page does not lose them; without a session they stay in the console.
 */
export const EVENT_NAMES = [
  "capture_started",
  "permission_denied",
  "frame_accepted",
  "frame_rejected",
  "room_completed",
  "quality_review_requested",
  "retake_requested",
  "upload_started",
  "upload_resumed",
  "reconstruction_submitted",
  "provider_status_changed",
  "artifact_downloaded",
  "processing_failed",
  "processing_completed",
  "panorama_stitched",
  "session_resumed",
  "session_reset",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export type ScannerEvent = { name: EventName; at: string; sessionId?: string; roomId?: string; fields?: Record<string, string | number | boolean | null> };

const buffer: ScannerEvent[] = [];
let flushTimer: number | undefined;
let getToken: (() => Promise<string | null>) | undefined;

export function configureTelemetry(tokenProvider: () => Promise<string | null>) {
  getToken = tokenProvider;
}

const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export function track(name: EventName, fields: ScannerEvent["fields"] = {}, ids: { sessionId?: string; roomId?: string } = {}) {
  const clean: NonNullable<ScannerEvent["fields"]> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 80);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value * 1000) / 1000;
    else if (typeof value === "boolean" || value === null) clean[key] = value;
  }
  const event: ScannerEvent = { name, at: new Date().toISOString(), sessionId: ids.sessionId, roomId: ids.roomId, fields: clean };
  buffer.push(event);
  if (process.env.NODE_ENV !== "production") console.debug("[sodar]", name, clean);
  if (typeof window !== "undefined") {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), 3_000);
  }
}

export async function flush(useBeacon = false): Promise<void> {
  if (!buffer.length || typeof window === "undefined") return;
  const batch = buffer.splice(0, 50);
  const token = getToken ? await getToken().catch(() => null) : null;
  if (!token) return; // nowhere to send without a session; console already has it in development
  const body = JSON.stringify({ events: batch });
  try {
    if (useBeacon && navigator.sendBeacon) {
      // Beacons cannot carry an Authorization header; pass the token in the body instead over HTTPS.
      navigator.sendBeacon("/api/scanner/events", new Blob([JSON.stringify({ events: batch, token })], { type: "application/json" }));
      return;
    }
    await fetch("/api/scanner/events", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body, keepalive: true });
  } catch {
    buffer.unshift(...batch);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}

/** Simple duration measurement helper for the timing metrics (capture, upload, stitch). */
export function stopwatch() {
  const started = performance.now();
  return () => Math.round(performance.now() - started);
}
