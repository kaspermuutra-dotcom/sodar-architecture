/** Per-user daily usage limits for credit-consuming endpoints, persisted in `usage_events`. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/supabase/server";

export type UsageKind = "astra_review" | "ai_fill";

const startOfUtcDay = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
};

export async function enforceDailyLimit(admin: SupabaseClient, ownerId: string, kind: UsageKind, limit: number): Promise<void> {
  const { count, error } = await admin.from("usage_events").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("kind", kind).gte("created_at", startOfUtcDay());
  if (error) throw new ApiError(503, "limits_unavailable", "Usage limits could not be checked. Try again shortly.");
  if ((count ?? 0) >= limit) throw new ApiError(429, "daily_limit_reached", "You have reached today's limit for this feature.");
  await admin.from("usage_events").insert({ owner_id: ownerId, kind });
}

/** Process-local token bucket for unauthenticated development use (no Supabase configured). */
const buckets = new Map<string, { tokens: number; at: number }>();
export function localRateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, at: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.at) / 60_000) * perMinute);
  bucket.at = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
