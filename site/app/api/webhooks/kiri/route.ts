import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reconstructionService } from "@/lib/reconstruction";
import { SupabaseJobStore } from "@/lib/reconstruction/store";
import { parseKiriWebhook, verifyKiriWebhook, webhookEventId } from "@/lib/reconstruction/webhooks";
import { sha256Hex } from "@/lib/server/hash";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_BODY = 16 * 1024;

/**
 * KIRI status webhook. Verified with KIRI_WEBHOOK_SECRET (constant time),
 * de-duplicated by event id, and then used only as a hint: the job is refreshed
 * through KIRI's own status endpoint, which is authoritative.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });
  const verification = verifyKiriWebhook(request.headers, raw);
  if (!verification.ok) {
    console.warn(JSON.stringify({ level: "warn", event: "webhook_rejected", provider: "kiri", reason: verification.reason }));
    return Response.json({ ok: false }, { status: verification.reason === "unconfigured" ? 503 : 401 });
  }
  const event = parseKiriWebhook(raw);
  if (!event) return Response.json({ ok: false }, { status: 400 });
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ ok: false }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = new SupabaseJobStore(admin);
  const fresh = await store.recordWebhookEvent("kiri", webhookEventId(event, raw), sha256Hex(raw));
  if (!fresh) return Response.json({ ok: true, duplicate: true });
  const jobs = await store.listJobsByExternalId("kiri", event.serialize);
  const service = reconstructionService(admin);
  const refreshed = await Promise.all(jobs.map((job) => service.refresh(job.id, { force: true }).catch(() => job)));
  console.info(JSON.stringify({ level: "info", event: "provider_webhook", provider: "kiri", method: verification.method, jobs: refreshed.map((job) => ({ id: job.id, status: job.status })) }));
  return Response.json({ ok: true });
}
