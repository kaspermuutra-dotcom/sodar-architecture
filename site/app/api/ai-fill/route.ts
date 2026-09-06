import { NextResponse } from "next/server";

/**
 * GPT Image 2 fill for a stitched panorama.
 *
 * The browser sends the panorama already padded to 1536×1024 (see
 * lib/scanner/ai-fill.ts) plus an alpha mask whose transparent pixels mark
 * what the model may paint: the ceiling/floor bands a single-ring capture
 * cannot see, and any gaps between frames. The route forwards both to the
 * OpenAI Images *edit* endpoint and streams the PNG back. The key never
 * reaches the client.
 *
 * Env: OPENAI_API_KEY (required), OPENAI_IMAGE_MODEL (default gpt-image-2),
 * OPENAI_IMAGE_QUALITY (low | medium | high, default medium).
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const PROMPT =
  "This is an equirectangular 360° panorama of a real room captured with a phone. " +
  "Fill only the transparent regions (the ceiling band at the top and the floor band at the bottom, and any thin gaps) " +
  "so the panorama becomes a complete, seamless 2:1 equirectangular sphere. Continue the existing ceiling, walls and floor exactly — " +
  "same materials, lighting and perspective, with correct equirectangular distortion near the poles. " +
  "Do not add furniture, people, text or objects. Keep every existing pixel unchanged.";

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "ai_fill_unconfigured", message: "OPENAI_API_KEY is not set on the server." }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "multipart form expected" }, { status: 400 });
  }
  const image = form.get("image");
  const mask = form.get("mask");
  if (!(image instanceof Blob)) return NextResponse.json({ error: "bad_request", message: "image is required" }, { status: 400 });
  if (image.size > 20 * 1024 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const upstream = new FormData();
  upstream.set("model", process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2");
  upstream.set("prompt", (form.get("prompt") as string | null) ?? PROMPT);
  upstream.set("size", "1536x1024");
  upstream.set("quality", process.env.OPENAI_IMAGE_QUALITY ?? "medium");
  upstream.set("image", image, "panorama.png");
  if (mask instanceof Blob) upstream.set("mask", mask, "mask.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: upstream });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: "upstream_error", status: res.status, message: text.slice(0, 2000) }, { status: 502 });
  }
  const payload = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) return NextResponse.json({ error: "no_image" }, { status: 502 });
  return new NextResponse(Buffer.from(b64, "base64"), { status: 200, headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
