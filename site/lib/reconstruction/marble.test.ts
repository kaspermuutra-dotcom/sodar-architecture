import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorldPrompt, MARBLE_FAITHFUL_PROMPT, marbleEstimate, marbleProvider, normalizeAzimuth } from "./marble";
import { ProviderError } from "./contract";

const env = { ...process.env };
const ref = { provider: "marble" as const, externalId: "op_abcdef123456", submittedAt: new Date().toISOString(), estimatedCredits: 1600 };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  process.env.WORLDLABS_API_KEY = "wl-test";
  delete process.env.WORLDLABS_MODEL;
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("Marble adapter", () => {
  it("estimates credits from the published table and prefers the panorama input price", () => {
    expect(marbleEstimate({ kind: "panorama", name: "p", bytes: new Uint8Array(), mimeType: "image/jpeg" }).credits).toBe(1500);
    expect(marbleEstimate({ kind: "images", frames: [{ name: "a", bytes: new Uint8Array(), mimeType: "image/jpeg" }, { name: "b", bytes: new Uint8Array(), mimeType: "image/jpeg" }] }).credits).toBe(1600);
    expect(marbleEstimate({ kind: "images", frames: [{ name: "a", bytes: new Uint8Array(), mimeType: "image/jpeg" }] }, "marble-1.0-draft").credits).toBe(230);
  });

  it("builds faithful prompts: no recaption, reconstruct_images, azimuths, constraint text", () => {
    const multi = buildWorldPrompt({ kind: "images", frames: [{ name: "a", bytes: new Uint8Array(), mimeType: "image/jpeg", azimuthDeg: -90 }, { name: "b", bytes: new Uint8Array(), mimeType: "image/jpeg", azimuthDeg: 450 }] }, ["m1", "m2"]);
    expect(multi.type).toBe("multi-image");
    if (multi.type !== "multi-image") throw new Error();
    expect(multi.reconstruct_images).toBe(true);
    expect(multi.disable_recaption).toBe(true);
    expect(multi.multi_image_prompt.map((p) => p.azimuth)).toEqual([270, 90]);
    expect(multi.text_prompt).toBe(MARBLE_FAITHFUL_PROMPT);
    expect(MARBLE_FAITHFUL_PROMPT).toMatch(/Do not add rooms, doors, windows, furniture, people/);
    const pano = buildWorldPrompt({ kind: "panorama", name: "p", bytes: new Uint8Array(), mimeType: "image/jpeg" }, ["m1"]);
    expect(pano).toMatchObject({ type: "image", is_pano: true, disable_recaption: true, image_prompt: { source: "media_asset", media_asset_id: "m1" } });
    expect(normalizeAzimuth(-0.05)).toBe(0);
  });

  it("validates input counts and formats before any network call", () => {
    expect(() => marbleProvider.validateInput({ kind: "images", frames: [] })).toThrow(ProviderError);
    expect(() => marbleProvider.validateInput({ kind: "images", frames: Array.from({ length: 9 }, () => ({ name: "a", bytes: new Uint8Array(2048), mimeType: "image/jpeg" })) })).toThrow(/1–8/);
    expect(() => marbleProvider.validateInput({ kind: "panorama", name: "p", bytes: new Uint8Array(2048), mimeType: "image/gif" })).toThrow(/JPEG/);
  });

  it("submits through prepare_upload → PUT → worlds:generate with the WLT-Api-Key header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("media-assets:prepare_upload")) return json({ media_asset: { media_asset_id: "asset_123456" }, upload_info: { upload_url: "https://upload.example/signed", upload_method: "PUT", required_headers: { "x-goog-meta": "1" } } });
      if (String(url).startsWith("https://upload.example/")) return new Response(null, { status: 200 });
      if (String(url).endsWith("worlds:generate")) return json({ operation_id: "op_abcdef123456", done: false, metadata: { progress: { status: "IN_PROGRESS" } } });
      throw new Error(`unexpected ${url}`);
    }));
    const result = await marbleProvider.submit({ kind: "panorama", name: "p", bytes: new Uint8Array(4096), mimeType: "image/jpeg" }, { displayName: "Room" });
    expect(result.externalId).toBe("op_abcdef123456");
    expect(result.estimatedCredits).toBe(1500);
    expect(calls[0].init.headers).toMatchObject({ "WLT-Api-Key": "wl-test" });
    expect(calls[1].url).toBe("https://upload.example/signed");
    expect(calls[1].init.method).toBe("PUT");
    const body = JSON.parse(String(calls[2].init.body));
    expect(body.model).toBe("marble-1.1");
    expect(body.permission).toEqual({ public: false });
    expect(body.world_prompt.is_pano).toBe(true);
  });

  it("maps operation states: in progress, failed, succeeded with cost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ operation_id: "op_abcdef123456", done: false, metadata: { progress: { status: "QUEUED" } }, expires_at: "2026-09-08T00:00:00Z" })));
    await expect(marbleProvider.status(ref)).resolves.toMatchObject({ status: "queued", expiresAt: "2026-09-08T00:00:00Z" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ operation_id: "op_abcdef123456", done: true, error: { code: 13, message: "internal" } })));
    await expect(marbleProvider.status(ref)).resolves.toMatchObject({ status: "failed", raw: "error:13" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ operation_id: "op_abcdef123456", done: true, metadata: { world_id: "world_12345678" }, response: { world_id: "world_12345678" }, cost: { total_credits: 1500 } })));
    await expect(marbleProvider.status(ref)).resolves.toMatchObject({ status: "ready", costCredits: 1500, details: { worldId: "world_12345678" } });
  });

  it("classifies 402, 429 (with Retry-After) and 422 without leaking detail text into messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ detail: "Insufficient credits" }, 402)));
    await expect(marbleProvider.balance()).rejects.toMatchObject({ retry: "insufficient_credits", code: "insufficient_credits" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ detail: "slow" }, 429, { "retry-after": "30" })));
    await expect(marbleProvider.status(ref)).rejects.toMatchObject({ retry: "rate_limited", retryAfterMs: 30_000 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ detail: [{ loc: ["body", "model"], msg: "bad" }] }, 422)));
    const error = await marbleProvider.status(ref).catch((e) => e);
    expect(error).toMatchObject({ retry: "fatal", code: "validation_error" });
    expect(error.message).not.toMatch(/bad/);
  });

  it("requires the server-side key and rejects malformed operations", async () => {
    delete process.env.WORLDLABS_API_KEY;
    expect(marbleProvider.enabled()).toBe(false);
    await expect(marbleProvider.balance()).rejects.toMatchObject({ code: "worldlabs_unconfigured" });
    process.env.WORLDLABS_API_KEY = "wl-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ nope: true })));
    await expect(marbleProvider.status(ref)).rejects.toMatchObject({ code: "invalid_operation", retry: "retryable" });
  });

  it("fetches world assets into provenance-labelled outputs and copies them rather than keeping URLs", async () => {
    const world = { world_id: "world_12345678", model: "marble-1.1", world_marble_url: "https://marble.worldlabs.ai/world/x", assets: { imagery: { pano_url: "https://assets.example/pano.jpg" }, splats: { spz_urls: { "100k": "https://assets.example/100k.spz", full_res: "https://assets.example/full.spz" } }, mesh: { collider_mesh_url: "https://assets.example/collider.glb" }, thumbnail_url: "https://assets.example/thumb.jpg" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/operations/op_abcdef123456")) return json({ operation_id: "op_abcdef123456", done: true, metadata: { world_id: "world_12345678" }, response: world, cost: { total_credits: 1500 } });
      if (u.includes("/worlds/world_12345678:export")) return json({ operation_id: "op_export12345", done: true, response: { asset_url: "https://assets.example/full.ply" } });
      if (u.includes("/worlds/world_12345678")) return json(world);
      if (u.startsWith("https://assets.example/")) return new Response(new Uint8Array([7, 7, 7]), { status: 200, headers: { "content-type": u.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream" } });
      throw new Error(`unexpected ${u}`);
    }));
    const outputs = await marbleProvider.fetchOutputs(ref);
    const types = outputs.map((o) => `${o.type}:${o.name}`);
    expect(types).toContain("marble_panorama:world_12345678-panorama.jpg");
    expect(types).toContain("marble_gaussian_splat:world_12345678-full_res.spz");
    expect(types).toContain("marble_collider_mesh:world_12345678-collider.glb");
    expect(types).toContain("marble_gaussian_splat:world_12345678.ply");
    expect(outputs.every((o) => o.provenance === "ai_generated")).toBe(true);
    expect(outputs.every((o) => o.bytes.byteLength === 3)).toBe(true);
  });
});
