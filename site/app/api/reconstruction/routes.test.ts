/**
 * Route-level guarantees: unauthenticated and misconfigured requests never
 * reach a provider, ownership is enforced, consent is required, and the
 * webhook rejects unsigned or replayed deliveries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const env = { ...process.env };
const authenticated = vi.fn();
const service = { createJobs: vi.fn(), refresh: vi.fn(), roomView: vi.fn(), estimate: vi.fn(), pollDue: vi.fn() };
const store = { recordWebhookEvent: vi.fn(), listJobsByExternalId: vi.fn() };

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, authenticated: (request: NextRequest) => authenticated(request) };
});
vi.mock("@/lib/reconstruction", () => ({ reconstructionService: () => service }));
vi.mock("@/lib/reconstruction/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reconstruction/store")>();
  return { ...actual, SupabaseJobStore: class { recordWebhookEvent = store.recordWebhookEvent; listJobsByExternalId = store.listJobsByExternalId; } };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

const { ApiError } = await import("@/lib/supabase/server");
const jobs = await import("./jobs/route");
const job = await import("./jobs/[id]/route");
const estimate = await import("./estimate/route");
const poll = await import("./poll/route");
const webhook = await import("../webhooks/kiri/route");

const OWNER = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const req = (url: string, init: { method?: string; body?: string; json?: unknown; headers?: Record<string, string> } = {}) => new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", body: init.json !== undefined ? JSON.stringify(init.json) : init.body, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KIRI_API_KEY = "k";
  process.env.WORLDLABS_API_KEY = "w";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  authenticated.mockResolvedValue({ userId: OWNER, admin: {}, db: {}, traceId: "trace" });
});
afterEach(() => {
  process.env = { ...env };
});

describe("reconstruction routes", () => {
  it("rejects unauthenticated job creation before touching the service", async () => {
    authenticated.mockRejectedValueOnce(new ApiError(401, "authentication_required", "Sign in."));
    const response = await jobs.POST(req("/api/reconstruction/jobs", { method: "POST", json: { scanId: SCAN, roomId: ROOM, consent: { aiProcessing: true, paid: true } } }));
    expect(response.status).toBe(401);
    expect(service.createJobs).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "authentication_required" } });
  });

  it("returns 503 when the backend is not configured", async () => {
    authenticated.mockRejectedValueOnce(new ApiError(503, "backend_unconfigured", "Capture storage is not configured yet."));
    const response = await estimate.POST(req("/api/reconstruction/estimate", { method: "POST", json: { roomId: ROOM } }));
    expect(response.status).toBe(503);
  });

  it("validates ids and passes consent flags through untouched", async () => {
    const bad = await jobs.POST(req("/api/reconstruction/jobs", { method: "POST", json: { scanId: "nope", roomId: ROOM } }));
    expect(bad.status).toBe(400);
    service.createJobs.mockResolvedValueOnce({ jobs: [], skipped: [] });
    const ok = await jobs.POST(req("/api/reconstruction/jobs", { method: "POST", json: { scanId: SCAN, roomId: ROOM, providers: ["kiri", "bogus"], consent: { aiProcessing: true, paid: "yes" } } }));
    expect(ok.status).toBe(202);
    expect(service.createJobs).toHaveBeenCalledWith(expect.objectContaining({ ownerId: OWNER, providers: ["kiri"], consent: { aiProcessing: true, paid: false } }));
  });

  it("returns 503 when every provider is disabled", async () => {
    process.env.RECONSTRUCTION_KILL_SWITCH = "1";
    const response = await jobs.POST(req("/api/reconstruction/jobs", { method: "POST", json: { scanId: SCAN, roomId: ROOM, consent: { aiProcessing: true, paid: true } } }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "no_provider_available" } });
  });

  it("hides jobs that belong to another user", async () => {
    service.refresh.mockResolvedValueOnce({ id: "j", ownerId: "someone-else", status: "ready" });
    const response = await job.GET(req("/api/reconstruction/jobs/j"), { params: Promise.resolve({ id: "j" }) });
    expect(response.status).toBe(404);
  });

  it("estimate never returns provider balances to the browser", async () => {
    service.estimate.mockResolvedValueOnce({ room: { id: ROOM, name: "Living", frameCount: 30 }, providers: [{ provider: "kiri", available: true, balance: 42, estimatedCredits: null, note: "", outputs: [], disclosure: "faithful_reconstruction", imageCount: 30 }], limits: { dailyJobsPerUser: 6, usedToday: 0, maxImagesPerJob: 300 } });
    const body = await (await estimate.POST(req("/api/reconstruction/estimate", { method: "POST", json: { roomId: ROOM } }))).json();
    expect(body.providers[0]).not.toHaveProperty("balance");
    expect(body.providers[0].available).toBe(true);
  });

  it("cron poll requires the shared secret", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    expect((await poll.GET(req("/api/reconstruction/poll"))).status).toBe(401);
    expect((await poll.GET(req("/api/reconstruction/poll", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    service.pollDue.mockResolvedValueOnce([]);
    expect((await poll.GET(req("/api/reconstruction/poll", { headers: { authorization: "Bearer cron-secret-value" } }))).status).toBe(200);
  });
});

describe("KIRI webhook route", () => {
  const body = JSON.stringify({ serialize: "796a6f52457844b4918db3eadd64becc", status: 2 });
  const signed = (secret: string) => ({ "x-kiri-signature": createHmac("sha256", secret).update(body).digest("hex") });

  it("returns 503 without a configured secret and 401 for bad signatures", async () => {
    delete process.env.KIRI_WEBHOOK_SECRET;
    expect((await webhook.POST(req("/api/webhooks/kiri", { method: "POST", body }))).status).toBe(503);
    process.env.KIRI_WEBHOOK_SECRET = "webhook-secret";
    expect((await webhook.POST(req("/api/webhooks/kiri", { method: "POST", body, headers: signed("other") }))).status).toBe(401);
    expect(store.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("processes a signed delivery once and treats a replay as a no-op", async () => {
    process.env.KIRI_WEBHOOK_SECRET = "webhook-secret";
    store.recordWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    store.listJobsByExternalId.mockResolvedValue([{ id: "job-1" }]);
    service.refresh.mockResolvedValue({ id: "job-1", status: "downloading" });
    const first = await webhook.POST(req("/api/webhooks/kiri", { method: "POST", body, headers: signed("webhook-secret") }));
    expect(first.status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith("job-1", { force: true });
    const replay = await webhook.POST(req("/api/webhooks/kiri", { method: "POST", body, headers: signed("webhook-secret") }));
    await expect(replay.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(service.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed payloads", async () => {
    process.env.KIRI_WEBHOOK_SECRET = "webhook-secret";
    const junk = JSON.stringify({ serialize: "../x", status: 2 });
    const response = await webhook.POST(req("/api/webhooks/kiri", { method: "POST", body: junk, headers: { "x-kiri-signature": createHmac("sha256", "webhook-secret").update(junk).digest("hex") } }));
    expect(response.status).toBe(400);
  });
});
