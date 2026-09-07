import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiFailure, backendConfigured, maybeAuthenticated } from "@/lib/supabase/server";
import { enforceDailyLimit, localRateLimit } from "@/lib/server/limits";
import { reconstructionConfig } from "@/lib/reconstruction/config";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GPT-6 Astra capture review. Runs after the free local quality gates and
 * before any paid reconstruction. Bounded input (≤ 8 low-detail frames), strict
 * structured output, no geometry inference, no location identification.
 *
 * Credit-consuming, so it is authenticated whenever the backend is configured
 * and counted against a per-user daily limit. Without Supabase (local
 * development) it falls back to a process-local rate limit.
 */
const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 400_000; // ≈ 300 KB of base64 per thumbnail
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const ISSUE_KINDS = ["blur", "motion", "exposure", "highlights", "shadows", "moving_subject", "reflection", "overlap", "low_texture", "inconsistent", "lens_contamination", "coverage", "reconstruction_risk", "other"] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["retake", "usable", "strong"] },
    summary: { type: "string" },
    guidance: { type: "string" },
    issues: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: [...ISSUE_KINDS] },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          detail: { type: "string" },
          instruction: { type: "string" },
          frameIndexes: { type: "array", maxItems: 8, items: { type: "integer" } },
        },
        required: ["kind", "severity", "title", "detail", "instruction", "frameIndexes"],
      },
    },
    reconstructionRisk: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["verdict", "summary", "guidance", "issues", "reconstructionRisk"],
} as const;

type RequestBody = { roomName?: unknown; captured?: unknown; targetCount?: unknown; images?: unknown; captureMode?: unknown; localFindings?: unknown; locale?: unknown };

function responseText(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const config = reconstructionConfig();
    const key = process.env.OPENAI_API_KEY;
    if (!key || !config.astra.enabled) return NextResponse.json({ error: "astra_unconfigured", message: "Capture review is not available right now." }, { status: 503 });
    const configuredModel = process.env.OPENAI_ASTRA_MODEL;
    const model = configuredModel?.startsWith("gpt-") ? configuredModel : "gpt-6-astra";

    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new ApiError(413, "too_large", "Too many review images were sent.");

    if (backendConfigured()) {
      const auth = await maybeAuthenticated(request);
      if (!auth) throw new ApiError(401, "authentication_required", "Sign in to review your capture.");
      traceId = auth.traceId;
      await enforceDailyLimit(auth.admin, auth.userId, "astra_review", config.limits.dailyAstraPerUser);
    } else {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      if (!localRateLimit(`astra:${ip}`, 6)) throw new ApiError(429, "rate_limited", "Too many reviews in a row. Wait a minute and try again.");
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "bad_request", message: "JSON body expected." }, { status: 400 });
    }

    const images = Array.isArray(body.images)
      ? body.images.filter((value): value is string => typeof value === "string" && value.length <= MAX_IMAGE_CHARS && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)).slice(0, MAX_IMAGES)
      : [];
    if (!images.length) return NextResponse.json({ error: "images_required", message: "At least one captured frame is required." }, { status: 400 });

    const localFindings = Array.isArray(body.localFindings) ? body.localFindings.filter((value): value is string => typeof value === "string").slice(0, 12).map((value) => value.slice(0, 120)) : [];
    const locale = typeof body.locale === "string" && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.locale) ? body.locale : "en";

    const prompt = [
      "You are SODAR's capture-quality reviewer for photo-based room reconstruction (panorama stitching and 3D Gaussian splatting).",
      "Review ONLY visible capture quality in the sample frames: blur, motion, exposure, blown highlights, blocked shadows, moving people or animals, reflections, insufficient overlap between neighbouring frames, low-texture walls, inconsistent frames (lens, exposure or white-balance jumps), possible lens contamination, incomplete coverage, and overall reconstruction risk.",
      "Do NOT infer hidden architecture, claim that reconstruction has run or completed, identify the property, its address or its location, estimate dimensions or measurements, or comment on the property's value or style.",
      "Every issue must carry ONE short physical instruction the person can follow while still standing in the room, e.g. 'Retake the last corner more slowly.', 'Add four photographs facing the plain wall.', 'Move one step away from the window.', 'Wait for the person to leave the room.'",
      "Prefer 'usable' unless a problem will visibly damage the result; use 'retake' only for problems that would make stitching or 3D reconstruction fail or look broken.",
      `Write summary, guidance, titles, details and instructions in the language with BCP-47 tag "${locale}". Keep them short and plain; no technical jargon.`,
      `Room: ${typeof body.roomName === "string" ? body.roomName.slice(0, 60) : "unnamed"}`,
      `Capture mode: ${body.captureMode === "full3d" ? "full 3D scan (walking through the room)" : "quick panorama (rotating in place)"}`,
      `Captured frames: ${Number(body.captured) || images.length}`,
      `Planned frames: ${Number(body.targetCount) || "unknown"}`,
      localFindings.length ? `Automatic local checks already flagged: ${localFindings.join("; ")}` : "Automatic local checks found nothing notable.",
      `frameIndexes refer to the ${images.length} sample images in order, starting at 0.`,
    ].join("\n");

    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }, ...images.map((image_url) => ({ type: "input_image", image_url, detail: "low" }))];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, reasoning: { effort: "low" }, input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "sodar_capture_review", strict: true, schema } } }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);

    if (!upstream) return NextResponse.json({ error: "upstream_timeout", message: "Capture review took too long. You can continue without it." }, { status: 504 });
    if (!upstream.ok) {
      console.error(JSON.stringify({ level: "error", event: "astra_review_failed", traceId, status: upstream.status }));
      return NextResponse.json({ error: "upstream_error", message: upstream.status === 401 ? "Capture review is not available right now." : "Capture review failed. You can continue without it." }, { status: 502 });
    }

    const payload = (await upstream.json()) as Record<string, unknown>;
    const text = responseText(payload);
    if (!text) return NextResponse.json({ error: "empty_response", message: "Capture review returned nothing." }, { status: 502 });
    try {
      const review = JSON.parse(text) as Record<string, unknown>;
      console.info(JSON.stringify({ level: "info", event: "quality_review_completed", traceId, verdict: review.verdict, issues: Array.isArray(review.issues) ? review.issues.length : 0 }));
      return NextResponse.json(review);
    } catch {
      return NextResponse.json({ error: "invalid_response", message: "Capture review returned an invalid result." }, { status: 502 });
    }
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
