import { describe, expect, it, vi } from "vitest";
import { backoffDelay, classifyHttp, parseRetryAfter, pollDelay, withRetry } from "./backoff";
import { ProviderError } from "./contract";

describe("backoff", () => {
  it("grows exponentially with full jitter and a cap", () => {
    expect(backoffDelay(0, { baseMs: 1000, jitter: () => 1 })).toBe(1000);
    expect(backoffDelay(3, { baseMs: 1000, jitter: () => 1 })).toBe(8000);
    expect(backoffDelay(20, { baseMs: 1000, maxMs: 30_000, jitter: () => 1 })).toBe(30_000);
    expect(backoffDelay(3, { baseMs: 1000, jitter: () => 0 })).toBe(0);
  });
  it("polls faster early and slower later", () => {
    expect(pollDelay(0)).toBe(5_000);
    expect(pollDelay(200_000)).toBe(20_000);
    expect(pollDelay(3_600_000)).toBe(60_000);
  });
  it("classifies HTTP statuses", () => {
    expect(classifyHttp(401)).toBe("unauthorized");
    expect(classifyHttp(402)).toBe("insufficient_credits");
    expect(classifyHttp(429)).toBe("rate_limited");
    expect(classifyHttp(503)).toBe("retryable");
    expect(classifyHttp(422)).toBe("fatal");
  });
  it("parses Retry-After seconds and dates, capped", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter("99999")).toBe(600_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeLessThanOrEqual(5000);
  });
  it("retries only transient provider errors and honours Retry-After", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new ProviderError("kiri", "rate_limited", "busy", "busy", 1234);
      return "ok";
    }, { sleep });
    expect(result).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1234);
  });
  it("never retries fatal, unauthorized or insufficient-credit errors, nor plain bugs", async () => {
    for (const retry of ["fatal", "unauthorized", "insufficient_credits"] as const) {
      const fn = vi.fn().mockRejectedValue(new ProviderError("marble", retry, "x", "x"));
      await expect(withRetry(fn, { sleep: async () => undefined })).rejects.toBeInstanceOf(ProviderError);
      expect(fn).toHaveBeenCalledTimes(1);
    }
    const bug = vi.fn().mockRejectedValue(new TypeError("bug"));
    await expect(withRetry(bug, { sleep: async () => undefined })).rejects.toBeInstanceOf(TypeError);
    expect(bug).toHaveBeenCalledTimes(1);
  });
});
