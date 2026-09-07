import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGES = 4;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["retake", "usable", "strong"] },
    summary: { type: "string" },
    guidance: { type: "string" },
    issues: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["severity", "title", "detail"],
      },
    },
  },
  required: ["verdict", "summary", "guidance", "issues"],
} as const;

type RequestBody = { roomName?: unknown; captured?: unknown; targetCount?: unknown; images?: unknown };

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

export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "astra_unconfigured", message: "OPENAI_API_KEY is not set on the server." }, { status: 503 });
  const configuredModel = process.env.OPENAI_ASTRA_MODEL;
  const model = configuredModel?.startsWith("gpt-") ? configuredModel : "gpt-6-astra";

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "JSON body expected." }, { status: 400 });
  }

  const images = Array.isArray(body.images)
    ? body.images.filter((value): value is string => typeof value === "string" && /^data:image\/(jpeg|png);base64,/.test(value)).slice(0, MAX_IMAGES)
    : [];
  if (!images.length) return NextResponse.json({ error: "images_required", message: "At least one captured frame is required." }, { status: 400 });

  const prompt = [
    "You are SODAR's capture-quality reviewer for real-estate panorama reconstruction.",
    "Assess only visible capture quality: blur, exposure, moving subjects, reflections, texture scarcity, major frame inconsistency, and likely stitching risk.",
    "Do not infer hidden geometry, claim reconstruction has run, identify an address, or embellish the property.",
    "Give one short actionable instruction the agent can follow while still in the room.",
    `Room: ${typeof body.roomName === "string" ? body.roomName : "unnamed"}`,
    `Captured frames: ${Number(body.captured) || images.length}`,
    `Planned frames: ${Number(body.targetCount) || "unknown"}`,
  ].join("\n");

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompt },
    ...images.map((image_url) => ({ type: "input_image", image_url, detail: "low" })),
  ];

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "sodar_capture_review", strict: true, schema } },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Astra capture review failed", upstream.status, detail.slice(0, 500));
    return NextResponse.json({ error: "upstream_error", message: upstream.status === 401 ? "The OpenAI API key was rejected." : "Astra review failed." }, { status: 502 });
  }

  const payload = (await upstream.json()) as Record<string, unknown>;
  const text = responseText(payload);
  if (!text) return NextResponse.json({ error: "empty_response", message: "Astra returned no review." }, { status: 502 });
  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "invalid_response", message: "Astra returned an invalid review." }, { status: 502 });
  }
}
