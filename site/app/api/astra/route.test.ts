import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe("POST /api/astra", () => {
  it("stays server-disabled when the key is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await POST(new NextRequest("http://localhost/api/astra", { method: "POST", body: "{}" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "astra_unconfigured" });
  });

  it("sends bounded image input and returns structured review data", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const review = { verdict: "usable", summary: "Usable capture.", guidance: "Retake the darkest corner.", issues: [], reconstructionRisk: "low" };
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(review) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", upstream);

    const response = await POST(new NextRequest("http://localhost/api/astra", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomName: "Living room", captured: 12, targetCount: 12, images: Array(9).fill("data:image/png;base64,AA==") }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(review);
    const request = JSON.parse(upstream.mock.calls[0][1].body as string);
    expect(request.model).toBe("gpt-6-astra");
    expect(request.input[0].content.filter((item: { type: string }) => item.type === "input_image")).toHaveLength(8);
  });
});
