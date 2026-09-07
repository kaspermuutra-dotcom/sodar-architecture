import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseKiriWebhook, verifyKiriWebhook, webhookEventId } from "./webhooks";

const body = JSON.stringify({ serialize: "796a6f52457844b4918db3eadd64becc", status: 2 });
const secret = "sodar-webhook-secret-123";

describe("KIRI webhook verification", () => {
  it("accepts a valid HMAC-SHA256 signature (hex or base64) in constant time", () => {
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    const b64 = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyKiriWebhook(new Headers({ "x-kiri-signature": `sha256=${hex}` }), body, secret)).toEqual({ ok: true, method: "hmac" });
    expect(verifyKiriWebhook(new Headers({ "x-signature": b64 }), body, secret)).toEqual({ ok: true, method: "hmac" });
    expect(verifyKiriWebhook(new Headers({ "x-kiri-signature": hex }), body + " ", secret)).toEqual({ ok: false, reason: "mismatch" });
  });
  it("accepts the shared secret as a bearer or header token", () => {
    expect(verifyKiriWebhook(new Headers({ authorization: `Bearer ${secret}` }), body, secret)).toEqual({ ok: true, method: "token" });
    expect(verifyKiriWebhook(new Headers({ "x-kiri-secret": "wrong" }), body, secret)).toEqual({ ok: false, reason: "mismatch" });
  });
  it("rejects unsigned requests and refuses to run without a configured secret", () => {
    expect(verifyKiriWebhook(new Headers(), body, secret)).toEqual({ ok: false, reason: "missing" });
    expect(verifyKiriWebhook(new Headers({ authorization: "Bearer x" }), body, undefined)).toEqual({ ok: false, reason: "unconfigured" });
    expect(verifyKiriWebhook(new Headers({ authorization: "Bearer x" }), body, "short")).toEqual({ ok: false, reason: "unconfigured" });
  });
  it("parses the documented payload, also when wrapped in data, and rejects junk", () => {
    expect(parseKiriWebhook(body)).toEqual({ serialize: "796a6f52457844b4918db3eadd64becc", status: 2 });
    expect(parseKiriWebhook(JSON.stringify({ data: { serialize: "job_12345678", status: 1 } }))).toEqual({ serialize: "job_12345678", status: 1 });
    expect(parseKiriWebhook("{")).toBeNull();
    expect(parseKiriWebhook(JSON.stringify({ serialize: "../x", status: 2 }))).toBeNull();
    expect(parseKiriWebhook(JSON.stringify({ serialize: "job_12345678", status: "done" }))).toBeNull();
  });
  it("derives a stable replay id from job, status and body", () => {
    const event = parseKiriWebhook(body)!;
    expect(webhookEventId(event, body)).toBe(webhookEventId(event, body));
    expect(webhookEventId(event, body)).not.toBe(webhookEventId({ ...event, status: 1 }, JSON.stringify({ ...event, status: 1 })));
  });
});
