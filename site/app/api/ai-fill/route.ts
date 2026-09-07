import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiFailure, backendConfigured, maybeAuthenticated } from "@/lib/supabase/server";
import { enforceDailyLimit, localRateLimit } from "@/lib/server/limits";
import { reconstructionConfig } from "@/lib/reconstruction/config";

/**
 * GPT Image 2 bounded completion for a stitched panorama.
 *
 * The browser sends the panorama padded to 1536×1024 (lib/scanner/ai-fill.ts)
 * plus an alpha mask whose transparent pixels are the ONLY region the model may
 * paint: the unseen ceiling/floor caps and narrow gaps. The prompt forbids
 * redesign, furniture, or changes to permanent features; the stitched original
 * and the coverage mask are always preserved alongside the derivative. The key
 * never reaches the client.
 *
 * Env: OPENAI_API_KEY (required), OPENAI_IMAGE_MODEL (default gpt-image-2),
 * OPENAI_IMAGE_QUALITY (low | medium | high, default medium).
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const FILL_PROMPT =
  "This is an equirectangular 360° panorama of a real room captured with a phone. " +
  "Paint ONLY the transparent regions (the unseen ceiling cap at the top, the unseen floor cap at the bottom, and thin gaps between photographs) " +
  "so the panorama becomes a complete, seamless 2:1 equirectangular sphere. Continue the existing ceiling, walls and floor exactly — same materials, colours, lighting and perspective, with correct equirectangular distortion near the poles. " +
  "Do not add furniture, people, objects, text, lamps, windows, doors or decoration. Do not remove or move anything. Do not restyle or brighten the room. Keep every opaque pixel unchanged.";

const QUALITIES = new Set(["low", "medium", "high"]);

export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const config = reconstructionConfig();
    const key = process.env.OPENAI_API_KEY;
    if (!key || !config.aiFill.enabled) return NextResponse.json({ error: "ai_fill_unconfigured", message: "Panorama completion is not available right now." }, { status: 503 });

    if (backendConfigured()) {
      const auth = await maybeAuthenticated(request);
      if (!auth) throw new ApiError(401, "authentication_required", "Sign in to complete the panorama.");
      traceId = auth.traceId;
      await enforceDailyLimit(auth.admin, auth.userId, "ai_fill", config.limits.dailyAiFillPerUser);
    } else {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      if (!localRateLimit(`ai-fill:${ip}`, 3)) throw new ApiError(429, "rate_limited", "Too many completions in a row. Wait a minute and try again.");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "bad_request", message: "multipart form expected" }, { status: 400 });
    }
    const image = form.get("image");
    const mask = form.get("mask");
    if (!(image instanceof Blob) || !(mask instanceof Blob)) return NextResponse.json({ error: "bad_request", message: "image and mask are required" }, { status: 400 });
    if (image.size > MAX_IMAGE_BYTES || mask.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
    if (image.type !== "image/png" || mask.type !== "image/png") return NextResponse.json({ error: "unsupported_type", message: "PNG panorama and mask expected." }, { status: 415 });
    const quality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";

    // The prompt is fixed server-side: callers cannot widen what the model may change.
    const upstream = new FormData();
    upstream.set("model", process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2");
    upstream.set("prompt", FILL_PROMPT);
    upstream.set("size", "1536x1024");
    upstream.set("quality", QUALITIES.has(quality) ? quality : "medium");
    upstream.set("image", image, "panorama.png");
    upstream.set("mask", mask, "mask.png");

    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: upstream, signal: AbortSignal.timeout(110_000) }).catch(() => null);
    if (!res) return NextResponse.json({ error: "upstream_timeout", message: "Panorama completion took too long." }, { status: 504 });
    if (!res.ok) {
      console.error(JSON.stringify({ level: "error", event: "ai_fill_failed", traceId, status: res.status }));
      return NextResponse.json({ error: "upstream_error", message: "Panorama completion failed. The captured panorama is unchanged." }, { status: 502 });
    }
    const payload = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "no_image" }, { status: 502 });
    console.info(JSON.stringify({ level: "info", event: "ai_fill_completed", traceId }));
    return new NextResponse(Buffer.from(b64, "base64"), { status: 200, headers: { "content-type": "image/png", "cache-control": "no-store", "x-sodar-provenance": "ai_generated" } });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
