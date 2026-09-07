/**
 * Provider webhook verification.
 *
 * KIRI signs each notification with a shared secret configured next to the
 * callback URL (docs.kiriengine.app/webhooks/creating-webhooks: "a secret …
 * used to sign each request"; the body carries `status` and `serialize`). The
 * public docs do not pin the header name or digest, so SODAR accepts either an
 * HMAC-SHA256 of the raw body (hex or base64) in a signature header, or the
 * secret itself as a bearer/`x-kiri-secret` token, both compared in constant
 * time — and then treats the event only as a *hint*: the job is refreshed by
 * calling KIRI's status endpoint, which is authoritative. A forged or replayed
 * webhook therefore can at most trigger one extra authenticated status read.
 */
import { createHmac } from "node:crypto";
import { safeEqual, sha256Hex } from "@/lib/server/hash";

export type WebhookVerification = { ok: true; method: "hmac" | "token" } | { ok: false; reason: "unconfigured" | "missing" | "mismatch" };

const SIGNATURE_HEADERS = ["x-kiri-signature", "x-signature", "x-webhook-signature", "kiri-signature"];
const TOKEN_HEADERS = ["x-kiri-secret", "x-webhook-secret", "x-kiri-token"];

export function verifyKiriWebhook(headers: Headers, rawBody: string, secret = process.env.KIRI_WEBHOOK_SECRET?.trim()): WebhookVerification {
  if (!secret || secret.length < 6) return { ok: false, reason: "unconfigured" };
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  const hex = digest.toString("hex");
  const b64 = digest.toString("base64");
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    const candidate = value.replace(/^sha256=/i, "").trim();
    if (safeEqual(candidate.toLowerCase(), hex) || safeEqual(candidate, b64)) return { ok: true, method: "hmac" };
    return { ok: false, reason: "mismatch" };
  }
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const tokens = [bearer, ...TOKEN_HEADERS.map((name) => headers.get(name)?.trim())].filter((value): value is string => Boolean(value));
  if (!tokens.length) return { ok: false, reason: "missing" };
  return tokens.some((token) => safeEqual(token, secret)) ? { ok: true, method: "token" } : { ok: false, reason: "mismatch" };
}

export type KiriWebhookEvent = { serialize: string; status: number };

export function parseKiriWebhook(rawBody: string): KiriWebhookEvent | null {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const body = parsed && typeof parsed.data === "object" && parsed.data ? (parsed.data as Record<string, unknown>) : parsed;
    const serialize = body.serialize;
    const status = Number(body.status);
    if (typeof serialize !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(serialize) || !Number.isInteger(status)) return null;
    return { serialize, status };
  } catch {
    return null;
  }
}

/** Replay identifier: same job + same status + same body is one delivery, however many times it arrives. */
export function webhookEventId(event: KiriWebhookEvent, rawBody: string): string {
  return `${event.serialize}:${event.status}:${sha256Hex(rawBody).slice(0, 16)}`;
}
