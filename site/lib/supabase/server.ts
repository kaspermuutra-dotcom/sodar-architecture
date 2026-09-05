import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

export async function authenticated(request: NextRequest): Promise<{ userId: string; db: SupabaseClient; admin: SupabaseClient; traceId: string }> {
  const { url, anonKey, configured } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configured || !serviceKey) throw new ApiError(503, "backend_unconfigured", "Capture storage is not configured yet.");
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) throw new ApiError(401, "authentication_required", "Sign in before uploading a scan.");
  const token = bearer.slice(7);
  const db = createClient(url!, anonKey!, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "invalid_session", "Your session expired. Sign in again to continue uploading.");
  const admin = createClient(url!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { userId: data.user.id, db, admin, traceId: request.headers.get("x-trace-id") ?? crypto.randomUUID() };
}

export function apiFailure(error: unknown, traceId?: string) {
  const known = error instanceof ApiError ? error : new ApiError(500, "internal_error", "The request could not be completed.");
  if (!(error instanceof ApiError)) console.error(JSON.stringify({ level: "error", event: "scanner_api_error", traceId, error: error instanceof Error ? error.message : String(error) }));
  return Response.json({ error: { code: known.code, message: known.message, retryable: known.status >= 500 }, traceId }, { status: known.status });
}

export function objectPath(userId: string, scanId: string, roomId: string, frameId: string) { return `${userId}/${scanId}/${roomId}/frames/${frameId}.jpg`; }
