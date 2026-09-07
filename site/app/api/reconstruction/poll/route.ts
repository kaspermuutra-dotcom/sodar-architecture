import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeEqual } from "@/lib/server/hash";
import { reconstructionService } from "@/lib/reconstruction";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron entry point (Vercel Cron or any scheduler): polls due provider jobs so
 * results are copied into SODAR storage even when nobody has the page open.
 * Protected by CRON_SECRET (bearer) — KIRI keeps models for only ~3 days.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(presented, secret)) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: { code: "backend_unconfigured" } }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const jobs = await reconstructionService(admin).pollDue(10);
  return Response.json({ polled: jobs.length, statuses: jobs.map((job) => ({ id: job.id, status: job.status })) });
}
