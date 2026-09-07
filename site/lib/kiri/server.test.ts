import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKiri3dgsJob, getKiriBalance, getKiriJobStatus, getKiriModelDownload, KiriApiError } from "./server";

const originalKey = process.env.KIRI_API_KEY;
const envelope = (data: unknown, code = 0) => Response.json({ code, msg: "success", data, ok: true });
const images = (n: number, type = "image/jpeg") => Array.from({ length: n }, (_, index) => new File([new Uint8Array(2048)], `${index}.jpg`, { type }));

beforeEach(() => {
  process.env.KIRI_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.KIRI_API_KEY;
  else process.env.KIRI_API_KEY = originalKey;
});

describe("KIRI server client", () => {
  it("requires a server-side API key", async () => {
    delete process.env.KIRI_API_KEY;
    await expect(getKiriBalance()).rejects.toMatchObject({ code: "kiri_unconfigured", status: 503, retry: "fatal" });
  });

  it("authenticates and reads the balance, accepting both success codes", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(envelope({ balance: 10 }, 200)).mockResolvedValueOnce(envelope({ balance: 3 }, 0));
    vi.stubGlobal("fetch", upstream);
    await expect(getKiriBalance()).resolves.toBe(10);
    await expect(getKiriBalance()).resolves.toBe(3);
    expect(upstream.mock.calls[0][0]).toBe("https://api.kiriengine.app/api/v1/open/balance");
    expect(upstream.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("classifies authentication failure, credit exhaustion and rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, msg: "unauthorized", data: null, ok: false }), { status: 401 })));
    await expect(getKiriBalance()).rejects.toMatchObject({ retry: "unauthorized", status: 401 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 403, msg: "no credit", data: null, ok: false }), { status: 403 })));
    await expect(createKiri3dgsJob(images(20))).rejects.toMatchObject({ retry: "insufficient_credits" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 429, msg: "slow down", data: null, ok: false }), { status: 429, headers: { "retry-after": "12" } })));
    await expect(getKiriBalance()).rejects.toMatchObject({ retry: "rate_limited", retryAfterMs: 12_000 });
  });

  it("treats malformed responses as retryable when the server errored and fatal otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(getKiriBalance()).rejects.toMatchObject({ code: "invalid_response", retry: "retryable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(getKiriBalance()).rejects.toMatchObject({ code: "invalid_response", retry: "fatal" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ balance: "many" })));
    await expect(getKiriBalance()).rejects.toMatchObject({ code: "invalid_balance" });
  });

  it("enforces KIRI's 20–300 image window and JPEG/PNG only before uploading", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    await expect(createKiri3dgsJob(images(19))).rejects.toBeInstanceOf(KiriApiError);
    await expect(createKiri3dgsJob(images(301))).rejects.toMatchObject({ code: "invalid_image_count" });
    await expect(createKiri3dgsJob(images(20, "image/gif"))).rejects.toMatchObject({ code: "unsupported_image", status: 415 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("creates a 3DGS job with the documented form fields", async () => {
    const upstream = vi.fn().mockResolvedValue(envelope({ serialize: "796a6f52457844b4918db3eadd64becc", calculateType: 3 }));
    vi.stubGlobal("fetch", upstream);
    const job = await createKiri3dgsJob(images(20), { mesh: true, fileFormat: "glb" });
    expect(job.serialize).toBe("796a6f52457844b4918db3eadd64becc");
    expect(upstream.mock.calls[0][0]).toBe("https://api.kiriengine.app/api/v1/open/3dgs/image");
    const form = upstream.mock.calls[0][1].body as FormData;
    expect(form.get("isMesh")).toBe("1");
    expect(form.get("fileFormat")).toBe("glb");
    expect(form.getAll("imagesFiles")).toHaveLength(20);
  });

  it("normalizes every documented status code", async () => {
    const expected: Record<number, string> = { [-1]: "uploading", 0: "processing", 1: "failed", 2: "succeeded", 3: "queued", 4: "expired" };
    for (const [code, state] of Object.entries(expected)) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ serialize: "job_12345678", status: Number(code) })));
      await expect(getKiriJobStatus("job_12345678")).resolves.toMatchObject({ state });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ serialize: "job_12345678", status: 9 })));
    await expect(getKiriJobStatus("job_12345678")).rejects.toMatchObject({ code: "invalid_status" });
    await expect(getKiriJobStatus("../etc")).rejects.toMatchObject({ code: "invalid_job_id" });
  });

  it("refuses downloads for unfinished or expired jobs and validates the download URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ serialize: "job_12345678", status: 4 })));
    await expect(getKiriModelDownload("job_12345678")).rejects.toMatchObject({ code: "job_not_ready", retry: "fatal" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(envelope({ serialize: "job_12345678", status: 2 })).mockResolvedValueOnce(envelope({ serialize: "job_12345678", modelUrl: "http://insecure.example/model.zip" })));
    await expect(getKiriModelDownload("job_12345678")).rejects.toMatchObject({ code: "invalid_download" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(envelope({ serialize: "job_12345678", status: 2 })).mockResolvedValueOnce(envelope({ serialize: "job_12345678", modelUrl: "https://cdn.example/model.zip" })));
    await expect(getKiriModelDownload("job_12345678")).resolves.toMatchObject({ modelUrl: "https://cdn.example/model.zip" });
  });
});
