import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiFailure, ApiError } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { EVENT_NAMES } from "@/lib/scanner/telemetry";

export const runtime = "nodejs";

const NAMES = new Set<string>(EVENT_NAMES);
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_BODY = 64 * 1024;

/** Accepts a batch of allow-listed scanner events and writes them as structured logs. Nothing else is stored. */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new ApiError(413, "too_large", "Event batch too large.");
    const body = JSON.parse(raw) as { events?: unknown; token?: unknown };
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || (typeof body.token === "string" ? body.token : "");
    const { url, anonKey, configured } = getSupabaseEnv();
    if (!configured || !bearer) return Response.json({ accepted: 0 });
    const db = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data } = await db.auth.getUser(bearer);
    if (!data.user) throw new ApiError(401, "invalid_session", "Session expired.");
    const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    let accepted = 0;
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const { name, at, sessionId, roomId, fields } = event as Record<string, unknown>;
      if (typeof name !== "string" || !NAMES.has(name)) continue;
      const safeFields: Record<string, unknown> = {};
      if (fields && typeof fields === "object") for (const [key, value] of Object.entries(fields as Record<string, unknown>).slice(0, 20)) if (/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key) && (typeof value === "number" || typeof value === "boolean" || value === null || (typeof value === "string" && value.length <= 80))) safeFields[key] = value;
      console.info(JSON.stringify({ level: "info", event: `scanner_${name}`, userId: data.user.id, at: typeof at === "string" ? at.slice(0, 40) : undefined, sessionId: typeof sessionId === "string" && UUID.test(sessionId) ? sessionId : undefined, roomId: typeof roomId === "string" && UUID.test(roomId) ? roomId : undefined, ...safeFields }));
      accepted++;
    }
    return Response.json({ accepted });
  } catch (error) {
    return apiFailure(error);
  }
}
