import { describe, expect, it, vi } from "vitest";
import { assertPublicHttpsUrl, fetchBytes } from "./safe-fetch";

describe("provider download guard", () => {
  it("accepts only https public hostnames", () => {
    expect(assertPublicHttpsUrl("https://cdn.kiriengine.app/x.zip", "kiri").hostname).toBe("cdn.kiriengine.app");
    for (const bad of ["http://cdn.example/x.zip", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://metadata.google.internal/x", "https://user:pw@cdn.example/x", "ftp://cdn.example/x", "not a url"]) {
      expect(() => assertPublicHttpsUrl(bad, "kiri"), bad).toThrow();
    }
  });
  it("caps the download size and follows only safe redirects", async () => {
    const big = new Uint8Array(2048);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(big, { status: 200, headers: { "content-type": "application/zip" } }));
    await expect(fetchBytes("https://cdn.example/x.zip", { provider: "kiri", maxBytes: 1024, fetchImpl })).rejects.toMatchObject({ code: "download_too_large" });
    const ok = await fetchBytes("https://cdn.example/x.zip", { provider: "kiri", maxBytes: 4096, fetchImpl });
    expect(ok.bytes.byteLength).toBe(2048);
    const redirecting = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/steal" } }));
    await expect(fetchBytes("https://cdn.example/x.zip", { provider: "marble", maxBytes: 4096, fetchImpl: redirecting })).rejects.toMatchObject({ code: "invalid_download_url" });
  });
  it("classifies missing assets as fatal and server errors as retryable", async () => {
    await expect(fetchBytes("https://cdn.example/x", { provider: "kiri", maxBytes: 10, fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 404 })) })).rejects.toMatchObject({ retry: "fatal" });
    await expect(fetchBytes("https://cdn.example/x", { provider: "kiri", maxBytes: 10, fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })) })).rejects.toMatchObject({ retry: "retryable" });
  });
});
