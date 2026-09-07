import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, type ProviderInput, type ProviderJobRef, type ProviderOutput, type ProviderStatus, type ReconstructionProvider } from "./contract";
import { combinedStatus, pickMarbleFrames, publicJob, ReconstructionService, thinFrames } from "./service";
import { MemoryJobStore, ORIGINALS_BUCKET, RECONSTRUCTION_BUCKET, type FrameRow } from "./store";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";

function fakeProvider(id: "kiri" | "marble", overrides: Partial<ReconstructionProvider> = {}): ReconstructionProvider & { submits: number; statuses: ProviderStatus[] } {
  const provider = {
    id,
    submits: 0,
    statuses: [{ status: "queued", raw: 3 }, { status: "processing", raw: 0 }, { status: "ready", raw: 2, costCredits: 5 }] as ProviderStatus[],
    capability: () => ({ provider: id, version: "test", outputs: [id === "kiri" ? "kiri_gaussian_splat" : "marble_gaussian_splat"], inputs: ["images"], imageCount: { min: id === "kiri" ? 20 : 1, max: 300 }, mediaTypes: ["image/jpeg"], supportsCancel: false, supportsWebhooks: false, retentionHours: 72, disclosure: id === "kiri" ? "faithful_reconstruction" : "generative_completion" }) as const,
    enabled: () => true,
    validateInput: (_input: ProviderInput) => undefined,
    estimateCost: () => ({ credits: 10, currency: "provider_credits" as const, note: "" }),
    balance: async () => 100,
    async submit(): Promise<ProviderJobRef> {
      provider.submits += 1;
      return { provider: id, externalId: `ext_${id}_${provider.submits}0000`, submittedAt: new Date().toISOString(), estimatedCredits: 10 };
    },
    async status(): Promise<ProviderStatus> {
      return provider.statuses.length > 1 ? provider.statuses.shift()! : provider.statuses[0];
    },
    async fetchOutputs(): Promise<ProviderOutput[]> {
      return [{ type: id === "kiri" ? "kiri_gaussian_splat" : "marble_gaussian_splat", name: "scene.ply", bytes: new Uint8Array([1, 2, 3]), mimeType: "application/x-ply", provenance: id === "kiri" ? "captured" : "ai_generated" }];
    },
    ...overrides,
  };
  return provider as unknown as ReconstructionProvider & { submits: number; statuses: ProviderStatus[] };
}

function seed(store: MemoryJobStore, frames = 24) {
  store.rooms.set(ROOM, { id: ROOM, scanId: SCAN, ownerId: OWNER, name: "Living", ordinal: 1, status: "capturing", frameCount: frames, captureMode: "full3d" });
  const rows: FrameRow[] = Array.from({ length: frames }, (_, i) => ({ id: `frame-${i}`, roomId: ROOM, checkpointIndex: i, yaw: (i * 360) / frames, pitch: 0, targetYaw: (i * 360) / frames, targetElevation: i % 5 === 0 ? 40 : 0, objectPath: `${OWNER}/${SCAN}/${ROOM}/frames/frame-${i}.jpg`, byteSize: 2048, mimeType: "image/jpeg", width: 4032, height: 3024, confirmedAt: new Date().toISOString(), qualityScore: 0.8 }));
  store.frames.set(ROOM, rows);
  for (const row of rows) store.objects.set(`${ORIGINALS_BUCKET}/${row.objectPath}`, { bytes: new Uint8Array(2048), mimeType: "image/jpeg" });
}

const request = (providers: Array<"kiri" | "marble"> = ["kiri"]) => ({ ownerId: OWNER, scanId: SCAN, roomId: ROOM, providers, wantMesh: false, consent: { aiProcessing: true, paid: true }, traceId: "trace-1" });
const quiet = () => undefined;

describe("ReconstructionService", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.KIRI_API_KEY = "k";
    process.env.WORLDLABS_API_KEY = "w";
    delete process.env.RECONSTRUCTION_KILL_SWITCH;
    delete process.env.SODAR_DAILY_JOBS_PER_USER;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("refuses to start without explicit consent", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const service = new ReconstructionService(store, { kiri: fakeProvider("kiri") }, quiet);
    await expect(service.createJobs({ ...request(), consent: { aiProcessing: true, paid: false } })).rejects.toMatchObject({ code: "consent_required" });
  });

  it("enforces scan ownership", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const service = new ReconstructionService(store, { kiri: fakeProvider("kiri") }, quiet);
    await expect(service.createJobs({ ...request(), ownerId: "99999999-9999-4999-8999-999999999999" })).rejects.toMatchObject({ code: "room_not_found", status: 404 });
    await expect(service.roomView("99999999-9999-4999-8999-999999999999", ROOM)).rejects.toMatchObject({ status: 404 });
  });

  it("submits once per provider and reconnects to the same job on repeated requests (no second charge)", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri");
    const service = new ReconstructionService(store, { kiri }, quiet);
    const first = await service.createJobs(request());
    expect(first.jobs).toHaveLength(1);
    expect(first.jobs[0].status).toBe("queued");
    expect(first.jobs[0].externalId).toMatch(/^ext_kiri_1/);
    const second = await service.createJobs(request());
    const third = await service.createJobs(request());
    expect(second.jobs[0].id).toBe(first.jobs[0].id);
    expect(third.jobs[0].id).toBe(first.jobs[0].id);
    expect(kiri.submits).toBe(1);
    expect(store.jobs.size).toBe(1);
  });

  it("does not resubmit after a provider failure; a new consented request is needed and inputs decide the key", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri", { submit: async () => { throw new ProviderError("kiri", "retryable", "upstream_timeout", "timeout"); } });
    const service = new ReconstructionService(store, { kiri }, quiet);
    const result = await service.createJobs(request());
    expect(result.jobs[0].status).toBe("failed");
    expect(result.jobs[0].failureCode).toBe("upstream_timeout");
    const again = await service.createJobs(request());
    expect(again.jobs[0].id).toBe(result.jobs[0].id);
    expect(again.jobs[0].status).toBe("failed");
  });

  it("fails fast on insufficient credits without contacting the provider's submit", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri", { balance: async () => 0 });
    const service = new ReconstructionService(store, { kiri }, quiet);
    const result = await service.createJobs(request());
    expect(result.jobs[0].status).toBe("failed");
    expect(result.jobs[0].failureCode).toBe("insufficient_credits");
    expect(kiri.submits).toBe(0);
  });

  it("maps provider 402/429/401 on submit to normalized failure codes", async () => {
    for (const [retry, code] of [["insufficient_credits", "insufficient_credits"], ["rate_limited", "provider_busy"], ["unauthorized", "provider_unauthorized"]] as const) {
      const store = new MemoryJobStore();
      seed(store);
      const kiri = fakeProvider("kiri", { submit: async () => { throw new ProviderError("kiri", retry, "x", "x"); } });
      const service = new ReconstructionService(store, { kiri }, quiet);
      const result = await service.createJobs(request());
      expect(result.jobs[0].failureCode).toBe(code);
    }
  });

  it("skips providers that are disabled or short of photos, never blocking the other", async () => {
    const store = new MemoryJobStore();
    seed(store, 10);
    const service = new ReconstructionService(store, { kiri: fakeProvider("kiri"), marble: fakeProvider("marble") }, quiet);
    const result = await service.createJobs(request(["kiri", "marble"]));
    expect(result.skipped).toEqual([{ provider: "kiri", reason: "not_enough_photos" }]);
    expect(result.jobs.map((job) => job.provider)).toEqual(["marble"]);
    const disabled = new ReconstructionService(store, { kiri: fakeProvider("kiri", { enabled: () => false }) }, quiet);
    await expect(disabled.createJobs(request())).resolves.toMatchObject({ skipped: [{ provider: "kiri", reason: "disabled" }] });
  });

  it("honours the kill switch and the per-user daily limit", async () => {
    const store = new MemoryJobStore();
    seed(store);
    process.env.RECONSTRUCTION_KILL_SWITCH = "1";
    await expect(new ReconstructionService(store, { kiri: fakeProvider("kiri") }, quiet).createJobs(request())).rejects.toMatchObject({ code: "processing_paused" });
    delete process.env.RECONSTRUCTION_KILL_SWITCH;
    process.env.SODAR_DAILY_JOBS_PER_USER = "1";
    const kiri = fakeProvider("kiri");
    const service = new ReconstructionService(store, { kiri, marble: fakeProvider("marble") }, quiet);
    const result = await service.createJobs(request(["kiri", "marble"]));
    expect(result.jobs[0].status).toBe("queued");
    expect(result.jobs[1].status).toBe("failed");
    expect(result.jobs[1].failureCode).toBe("daily_limit_reached");
  });

  it("polls only when due, follows queue → processing → ready, downloads outputs once, records cost and provenance", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri");
    const fetchSpy = vi.spyOn(kiri, "fetchOutputs");
    const service = new ReconstructionService(store, { kiri }, quiet);
    const [job] = (await service.createJobs(request())).jobs;
    // Not due yet: no provider call.
    const untouched = await service.refresh(job.id);
    expect(untouched.status).toBe("queued");
    expect(kiri.statuses).toHaveLength(3);
    const processing = await service.refresh(job.id, { force: true });
    expect(processing.status).toBe("queued");
    const p2 = await service.refresh(job.id, { force: true });
    expect(p2.status).toBe("processing");
    const ready = await service.refresh(job.id, { force: true });
    expect(ready.status).toBe("ready");
    expect(ready.actualCredits).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const artifacts = await store.listArtifacts({ roomId: ROOM });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ type: "kiri_gaussian_splat", provenance: "captured", aiGenerated: false, bucket: RECONSTRUCTION_BUCKET, byteSize: 3, providerJobId: ready.externalId });
    expect(artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.objects.has(`${RECONSTRUCTION_BUCKET}/${artifacts[0].objectPath}`)).toBe(true);
    // Terminal: further refreshes never call the provider again.
    await service.refresh(job.id, { force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("marks failed and expired provider states terminal with a normalized code", async () => {
    for (const state of ["failed", "expired"] as const) {
      const store = new MemoryJobStore();
      seed(store);
      const kiri = fakeProvider("kiri");
      kiri.statuses = [{ status: state, raw: state === "failed" ? 1 : 4 }];
      const service = new ReconstructionService(store, { kiri }, quiet);
      const [job] = (await service.createJobs(request())).jobs;
      const refreshed = await service.refresh(job.id, { force: true });
      expect(refreshed.status).toBe(state);
      expect(refreshed.failureCode).toBe(state === "failed" ? "provider_failed" : "provider_expired");
    }
  });

  it("backs off on transient poll failures and fails after repeated ones", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri", { status: async () => { throw new ProviderError("kiri", "retryable", "upstream_timeout", "t"); } });
    const service = new ReconstructionService(store, { kiri }, quiet);
    const [job] = (await service.createJobs(request())).jobs;
    let current = job;
    for (let i = 0; i < 7; i++) current = await service.refresh(job.id, { force: true });
    expect(current.status).toBe("queued");
    expect(Date.parse(current.nextPollAt!)).toBeGreaterThan(Date.now());
    current = await service.refresh(job.id, { force: true });
    expect(current.status).toBe("failed");
    expect(current.failureCode).toBe("upstream_timeout");
  });

  it("returns to processing when a download fails transiently, and fails after five attempts", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri", { fetchOutputs: async () => { throw new ProviderError("kiri", "retryable", "download_failed", "d"); } });
    kiri.statuses = [{ status: "ready", raw: 2 }];
    const service = new ReconstructionService(store, { kiri }, quiet);
    const [job] = (await service.createJobs(request())).jobs;
    let current = await service.refresh(job.id, { force: true });
    expect(current.status).toBe("processing");
    for (let i = 0; i < 4; i++) current = await service.refresh(job.id, { force: true });
    expect(current.status).toBe("failed");
    expect(current.failureCode).toBe("download_failed");
  });

  it("reports partial success when one provider finishes and the other fails", async () => {
    const store = new MemoryJobStore();
    seed(store);
    const kiri = fakeProvider("kiri");
    kiri.statuses = [{ status: "ready", raw: 2 }];
    const marble = fakeProvider("marble");
    marble.statuses = [{ status: "failed", raw: "error:500" }];
    const service = new ReconstructionService(store, { kiri, marble }, quiet);
    const created = await service.createJobs(request(["kiri", "marble"]));
    for (const job of created.jobs) await service.refresh(job.id, { force: true });
    const view = await service.roomView(OWNER, ROOM);
    expect(view.status).toBe("partially_ready");
    expect(view.artifacts).toHaveLength(1);
    expect(view.artifacts[0].url).toContain("memory://");
    expect(view.jobs.map((job) => job.status).sort()).toEqual(["failed", "ready"]);
  });

  it("estimate exposes availability and reasons without contacting submit", async () => {
    const store = new MemoryJobStore();
    seed(store, 10);
    const kiri = fakeProvider("kiri");
    const marble = fakeProvider("marble", { balance: async () => { throw new ProviderError("marble", "unauthorized", "x", "x"); } });
    const service = new ReconstructionService(store, { kiri, marble }, quiet);
    const estimate = await service.estimate(OWNER, ROOM, ["kiri", "marble"]);
    expect(estimate.providers.find((p) => p.provider === "kiri")).toMatchObject({ available: false, reason: "not_enough_photos" });
    expect(estimate.providers.find((p) => p.provider === "marble")).toMatchObject({ available: false, reason: "provider_unauthorized" });
    expect(kiri.submits).toBe(0);
  });

  it("public views never leak provider raw status, balances or diagnostics", () => {
    const view = publicJob({ id: "j", scanId: SCAN, roomId: ROOM, ownerId: OWNER, provider: "kiri", status: "ready", idempotencyKey: "k".repeat(20), externalId: "ext", submittedAt: null, inputKind: "images", inputCount: 20, inputSha256: "a".repeat(64), wantMesh: false, estimatedCredits: 1, actualCredits: 1, balanceBefore: 99, balanceAfter: 98, attempts: 1, nextPollAt: null, lastPolledAt: null, providerStatusRaw: "2", failureCode: null, failureMessage: "secret detail", expiresAt: null, details: { worldId: "w" }, diagnostics: { providerCode: 500 }, traceId: "t", createdAt: "", updatedAt: "", finishedAt: null });
    expect(view).not.toHaveProperty("balanceBefore");
    expect(view).not.toHaveProperty("providerStatusRaw");
    expect(view).not.toHaveProperty("diagnostics");
    expect(view).not.toHaveProperty("failureMessage");
    expect(view).not.toHaveProperty("externalId");
  });

  it("helpers: thinning keeps order, Marble picks horizon frames around the room, combined status is conservative", () => {
    expect(thinFrames([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
    const frames: FrameRow[] = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, roomId: ROOM, checkpointIndex: i, yaw: (i * 12) % 360, pitch: 0, targetYaw: 0, targetElevation: i % 3 === 0 ? 50 : 0, objectPath: "", byteSize: 1, mimeType: "image/jpeg", width: 1, height: 1, confirmedAt: "x", qualityScore: null }));
    const picked = pickMarbleFrames(frames, 6);
    expect(picked).toHaveLength(6);
    expect(picked.every((frame) => frame.targetElevation === 0)).toBe(true);
    expect(combinedStatus([])).toBe("none");
    const base = { scanId: SCAN, roomId: ROOM, ownerId: OWNER, idempotencyKey: "", externalId: null, submittedAt: null, inputKind: "images" as const, inputCount: 0, inputSha256: "", wantMesh: false, estimatedCredits: null, actualCredits: null, balanceBefore: null, balanceAfter: null, attempts: 0, nextPollAt: null, lastPolledAt: null, providerStatusRaw: null, failureCode: null, failureMessage: null, expiresAt: null, details: {}, diagnostics: {}, traceId: "", createdAt: "", updatedAt: "", finishedAt: null };
    expect(combinedStatus([{ ...base, id: "a", provider: "kiri", status: "ready" }, { ...base, id: "b", provider: "marble", status: "processing" }])).toBe("processing");
    expect(combinedStatus([{ ...base, id: "a", provider: "kiri", status: "ready" }, { ...base, id: "b", provider: "marble", status: "failed" }])).toBe("partially_ready");
    expect(combinedStatus([{ ...base, id: "a", provider: "kiri", status: "expired" }])).toBe("expired");
  });
});
