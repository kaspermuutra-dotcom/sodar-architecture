/**
 * Reconstruction job orchestration.
 *
 * Invariants:
 *  - one paid provider job per idempotency key, claimed with a compare-and-set
 *    before any provider call, so refreshes, reconnects and duplicate webhooks
 *    never create a second charge;
 *  - a provider is only ever contacted for jobs in an active status;
 *  - a failed provider job is never resubmitted automatically;
 *  - every successful output is copied into SODAR-controlled private storage
 *    with a SHA-256, byte size, MIME type and provenance before the job is
 *    marked ready — the provider's temporary URL is never the permanent asset;
 *  - Marble failing never blocks a KIRI result (jobs are independent rows).
 */
import { sha256Hex } from "@/lib/server/hash";
import { ApiError } from "@/lib/supabase/server";
import { backoffDelay, pollDelay } from "./backoff";
import { reconstructionConfig } from "./config";
import { ProviderError, type JobStatus, type ProviderId, type ProviderInput, type ReconstructionProvider } from "./contract";
import { ACTIVE_STATUSES, newJobId, ORIGINALS_BUCKET, RECONSTRUCTION_BUCKET, type FrameRow, type JobRecord, type JobStore, type StoredArtifact } from "./store";

export const PROCESSING_VERSION = "sodar-reconstruction/2026-09";
const INPUT_VERSION = "v1";
const SIGNED_URL_SECONDS = 600;
const MAX_POLL_FAILURES = 8;

export type Providers = Partial<Record<ProviderId, ReconstructionProvider>>;

export type CreateJobsRequest = { ownerId: string; scanId: string; roomId: string; providers: ProviderId[]; wantMesh: boolean; consent: { aiProcessing: boolean; paid: boolean }; traceId: string; now?: () => Date };

export type CreateJobsResult = { jobs: JobRecord[]; skipped: Array<{ provider: ProviderId; reason: string }> };

export type Logger = (event: string, fields: Record<string, unknown>) => void;
export const jsonLogger: Logger = (event, fields) => console.info(JSON.stringify({ level: "info", event, ...fields }));

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

/** Evenly thins a frame list to at most `max` items while keeping capture order. */
export function thinFrames<T>(frames: T[], max: number): T[] {
  if (frames.length <= max) return frames;
  const step = frames.length / max;
  return Array.from({ length: max }, (_, index) => frames[Math.floor(index * step)]);
}

/** Picks up to `count` horizon-level frames spread around the room for Marble's multi-image input. */
export function pickMarbleFrames(frames: FrameRow[], count = 6): FrameRow[] {
  const horizon = frames.filter((frame) => Math.abs(frame.targetElevation) < 20);
  const pool = horizon.length >= 2 ? horizon : frames;
  if (pool.length <= count) return pool;
  const sorted = [...pool].sort((a, b) => ((a.yaw % 360) + 360) % 360 - (((b.yaw % 360) + 360) % 360));
  return thinFrames(sorted, count);
}

export class ReconstructionService {
  constructor(private readonly store: JobStore, private readonly providers: Providers, private readonly log: Logger = jsonLogger) {}

  provider(id: ProviderId): ReconstructionProvider {
    const provider = this.providers[id];
    if (!provider) throw new ApiError(503, "provider_unavailable", "This processing option is not available right now.");
    return provider;
  }

  /** Server-side estimate shown on the consent sheet: availability, balance and expected credits per provider. */
  async estimate(ownerId: string, roomId: string, requested: ProviderId[]) {
    const room = await this.store.getRoom(roomId, ownerId);
    if (!room) throw new ApiError(404, "room_not_found", "The room was not found.");
    const frames = await this.store.listConfirmedFrames(roomId);
    const config = reconstructionConfig();
    const usedToday = await this.store.countJobsSince(ownerId, startOfUtcDay(new Date()));
    const out = [] as Array<{ provider: ProviderId; available: boolean; reason?: string; balance: number | null; estimatedCredits: number | null; note: string; outputs: string[]; disclosure: string; imageCount: number }>;
    for (const id of requested) {
      const provider = this.providers[id];
      const capability = provider?.capability();
      if (!provider || !capability || !provider.enabled()) {
        out.push({ provider: id, available: false, reason: "disabled", balance: null, estimatedCredits: null, note: "", outputs: capability?.outputs ?? [], disclosure: capability?.disclosure ?? "faithful_reconstruction", imageCount: frames.length });
        continue;
      }
      const inputCount = id === "kiri" ? Math.min(frames.length, config.limits.maxImagesPerJob) : Math.min(frames.length, capability.imageCount.max);
      let reason: string | undefined;
      if (frames.length < capability.imageCount.min) reason = "not_enough_photos";
      let balance: number | null = null;
      try {
        balance = await provider.balance();
      } catch (error) {
        reason ??= error instanceof ProviderError && error.retry === "unauthorized" ? "provider_unauthorized" : "balance_unavailable";
      }
      const minimum = id === "kiri" ? config.limits.minKiriBalance : config.limits.minMarbleBalance;
      if (balance !== null && balance < minimum) reason ??= "insufficient_credits";
      const estimate = id === "kiri" ? provider.estimateCost({ kind: "images", frames: [] }) : provider.estimateCost(frames.length ? { kind: "images", frames: Array.from({ length: Math.min(frames.length, 6) }, () => ({ name: "", bytes: new Uint8Array(), mimeType: "image/jpeg" })) } : { kind: "panorama", name: "", bytes: new Uint8Array(), mimeType: "image/jpeg" });
      out.push({ provider: id, available: !reason, reason, balance, estimatedCredits: estimate.credits, note: estimate.note, outputs: capability.outputs, disclosure: capability.disclosure, imageCount: inputCount });
    }
    return { room: { id: room.id, name: room.name, frameCount: frames.length }, providers: out, limits: { dailyJobsPerUser: config.limits.dailyJobsPerUser, usedToday, maxImagesPerJob: config.limits.maxImagesPerJob } };
  }

  /** Creates (or returns) one job per requested provider and submits it. Requires explicit consent flags. */
  async createJobs(request: CreateJobsRequest): Promise<CreateJobsResult> {
    if (!request.consent.aiProcessing || !request.consent.paid) throw new ApiError(400, "consent_required", "Confirm processing before starting a reconstruction.");
    const now = request.now ?? (() => new Date());
    const config = reconstructionConfig();
    if (config.killSwitch) throw new ApiError(503, "processing_paused", "Processing is paused right now. Your photos are safe; try again later.");
    const room = await this.store.getRoom(request.roomId, request.ownerId);
    if (!room || room.scanId !== request.scanId) throw new ApiError(404, "room_not_found", "The room was not found.");
    const frames = await this.store.listConfirmedFrames(request.roomId);
    const jobs: JobRecord[] = [];
    const skipped: CreateJobsResult["skipped"] = [];
    for (const id of request.providers) {
      const provider = this.providers[id];
      if (!provider || !provider.enabled()) {
        skipped.push({ provider: id, reason: "disabled" });
        continue;
      }
      const capability = provider.capability();
      if (frames.length < capability.imageCount.min) {
        skipped.push({ provider: id, reason: "not_enough_photos" });
        continue;
      }
      const selected = id === "kiri" ? thinFrames(frames, Math.min(config.limits.maxImagesPerJob, capability.imageCount.max)) : pickMarbleFrames(frames);
      const inputSha = sha256Hex(selected.map((frame) => frame.id).join("\n") + `\n${request.wantMesh ? "mesh" : "splat"}`);
      const idempotencyKey = `recon:${request.roomId}:${id}:${inputSha.slice(0, 16)}:${INPUT_VERSION}`;
      const created = await this.store.insertJob({
        id: newJobId(), scanId: request.scanId, roomId: request.roomId, ownerId: request.ownerId, provider: id, status: "validating", idempotencyKey, externalId: null, submittedAt: null, inputKind: "images", inputCount: selected.length, inputSha256: inputSha, wantMesh: request.wantMesh && id === "kiri", estimatedCredits: null, actualCredits: null, balanceBefore: null, balanceAfter: null, attempts: 0, nextPollAt: null, lastPolledAt: null, providerStatusRaw: null, failureCode: null, failureMessage: null, expiresAt: null, details: {}, diagnostics: {}, traceId: request.traceId, createdAt: now().toISOString(), updatedAt: now().toISOString(), finishedAt: null,
      });
      if (!created.created) {
        // Same room, same inputs, same provider: reconnect to the existing job. No second charge.
        this.log("reconstruction_job_reused", { traceId: request.traceId, jobId: created.job.id, provider: id, status: created.job.status });
        jobs.push(created.job);
        continue;
      }
      // Daily limit is checked after the idempotent insert so a reconnect never counts twice; a brand-new job beyond the limit is failed before submission.
      const usedToday = await this.store.countJobsSince(request.ownerId, startOfUtcDay(now()));
      if (usedToday > config.limits.dailyJobsPerUser) {
        const failed = await this.store.updateJob(created.job.id, { status: "failed", failureCode: "daily_limit_reached", failureMessage: "Daily processing limit reached.", finishedAt: now().toISOString() }, "validating");
        if (failed) jobs.push(failed);
        continue;
      }
      const claimed = await this.store.updateJob(created.job.id, { status: "uploading", attempts: 1 }, "validating");
      if (!claimed) {
        jobs.push((await this.store.getJob(created.job.id)) ?? created.job);
        continue;
      }
      jobs.push(await this.submit(claimed, provider, selected));
    }
    return { jobs, skipped };
  }

  private async submit(job: JobRecord, provider: ReconstructionProvider, frames: FrameRow[]): Promise<JobRecord> {
    const config = reconstructionConfig();
    const fail = async (code: string, message: string, diagnostics: Record<string, unknown> = {}) => {
      this.log("reconstruction_submit_failed", { traceId: job.traceId, jobId: job.id, provider: job.provider, code });
      return (await this.store.updateJob(job.id, { status: "failed", failureCode: code, failureMessage: message, finishedAt: new Date().toISOString(), diagnostics: { ...job.diagnostics, ...diagnostics } }, "uploading")) ?? job;
    };
    let balanceBefore: number | null = null;
    try {
      balanceBefore = await provider.balance();
    } catch (error) {
      if (error instanceof ProviderError && error.retry === "unauthorized") return fail("provider_unauthorized", "Processing is not available right now.", { providerCode: error.code });
      // Balance endpoint hiccup: continue, the submission itself is the authoritative check (402/403).
    }
    const minimum = job.provider === "kiri" ? config.limits.minKiriBalance : config.limits.minMarbleBalance;
    if (balanceBefore !== null && balanceBefore < minimum) return fail("insufficient_credits", "Processing credits are exhausted.", { balanceBefore });
    let input: ProviderInput;
    try {
      const loaded = await Promise.all(frames.map(async (frame, index) => ({ name: `frame-${String(frame.checkpointIndex).padStart(3, "0")}`, bytes: await this.store.getObject(ORIGINALS_BUCKET, frame.objectPath), mimeType: frame.mimeType, azimuthDeg: ((frame.yaw % 360) + 360) % 360, index })));
      for (const [index, frame] of frames.entries()) if (loaded[index].bytes.byteLength !== frame.byteSize) return fail("input_integrity", "A saved photo did not match its record.", { frameId: frame.id });
      input = { kind: "images", frames: loaded };
      provider.validateInput(input);
    } catch (error) {
      if (error instanceof ProviderError) return fail(error.code, "The photos could not be prepared for processing.");
      return fail("input_unavailable", "The saved photos could not be read.");
    }
    try {
      const ref = await provider.submit(input, { displayName: `SODAR room ${job.roomId.slice(0, 8)}`, wantMesh: job.wantMesh });
      this.log("reconstruction_submitted", { traceId: job.traceId, jobId: job.id, provider: job.provider, externalId: ref.externalId, inputCount: input.frames.length });
      return (await this.store.updateJob(job.id, { status: "queued", externalId: ref.externalId, submittedAt: ref.submittedAt, estimatedCredits: ref.estimatedCredits, balanceBefore, nextPollAt: new Date(Date.now() + pollDelay(0)).toISOString() }, "uploading")) ?? job;
    } catch (error) {
      if (error instanceof ProviderError) {
        const code = error.retry === "insufficient_credits" ? "insufficient_credits" : error.retry === "unauthorized" ? "provider_unauthorized" : error.retry === "rate_limited" ? "provider_busy" : error.code;
        return fail(code, error.retry === "rate_limited" ? "The processing service is busy. Try again in a few minutes." : "Processing could not be started.", { providerCode: error.code, retry: error.retry, httpStatus: error.httpStatus ?? null });
      }
      return fail("submit_error", "Processing could not be started.");
    }
  }

  /** Polls the provider when due, downloads outputs on success. Safe to call from a request handler, a cron, or a webhook. */
  async refresh(jobId: string, options: { force?: boolean } = {}): Promise<JobRecord> {
    const job = await this.store.getJob(jobId);
    if (!job) throw new ApiError(404, "job_not_found", "The processing job was not found.");
    if (!ACTIVE_STATUSES.includes(job.status) || !job.externalId) return job;
    if (job.status === "downloading" || job.status === "uploading" || job.status === "validating") return job;
    const now = Date.now();
    if (!options.force && job.nextPollAt && Date.parse(job.nextPollAt) > now) return job;
    const provider = this.providers[job.provider];
    if (!provider) return job;
    const elapsed = job.submittedAt ? now - Date.parse(job.submittedAt) : 0;
    let status;
    try {
      status = await provider.status({ provider: job.provider, externalId: job.externalId, submittedAt: job.submittedAt ?? job.createdAt, estimatedCredits: job.estimatedCredits });
    } catch (error) {
      return this.pollFailure(job, error);
    }
    const base: Partial<JobRecord> = { lastPolledAt: new Date(now).toISOString(), providerStatusRaw: String(status.raw), expiresAt: status.expiresAt ?? job.expiresAt, details: { ...job.details, ...(status.details ?? {}) } };
    if (status.status === "failed" || status.status === "expired") {
      this.log("reconstruction_provider_status", { traceId: job.traceId, jobId: job.id, provider: job.provider, status: status.status });
      return (await this.store.updateJob(job.id, { ...base, status: status.status, failureCode: status.status === "expired" ? "provider_expired" : "provider_failed", failureMessage: status.status === "expired" ? "The provider discarded this job before SODAR could download it." : "The provider could not build this room.", actualCredits: status.costCredits ?? job.actualCredits, finishedAt: new Date().toISOString() }, ["queued", "processing"])) ?? job;
    }
    if (status.status !== "ready") {
      const next: JobStatus = status.status === "uploading" ? "queued" : status.status;
      if (next !== job.status) this.log("reconstruction_provider_status", { traceId: job.traceId, jobId: job.id, provider: job.provider, status: next });
      return (await this.store.updateJob(job.id, { ...base, status: next, nextPollAt: new Date(now + pollDelay(elapsed)).toISOString() }, ["queued", "processing"])) ?? job;
    }
    // Claim the download so a concurrent poll (cron + webhook + client) copies outputs once.
    const claimed = await this.store.updateJob(job.id, { ...base, status: "downloading" }, ["queued", "processing"]);
    if (!claimed) return (await this.store.getJob(job.id)) ?? job;
    return this.download(claimed, provider, status.costCredits ?? null);
  }

  private async pollFailure(job: JobRecord, error: unknown): Promise<JobRecord> {
    const failures = Number(job.diagnostics.pollFailures ?? 0) + 1;
    const providerError = error instanceof ProviderError ? error : undefined;
    const fatal = providerError ? providerError.retry === "fatal" || providerError.retry === "unauthorized" : false;
    this.log("reconstruction_poll_failed", { traceId: job.traceId, jobId: job.id, provider: job.provider, code: providerError?.code ?? "unknown", retry: providerError?.retry ?? "unknown", failures });
    if (fatal || failures >= MAX_POLL_FAILURES) {
      return (await this.store.updateJob(job.id, { status: "failed", failureCode: providerError?.code ?? "poll_failed", failureMessage: "The processing service stopped responding for this room.", finishedAt: new Date().toISOString(), diagnostics: { ...job.diagnostics, pollFailures: failures } }, ACTIVE_STATUSES)) ?? job;
    }
    const delay = providerError?.retryAfterMs ?? backoffDelay(failures, { baseMs: 5_000, maxMs: 300_000 });
    return (await this.store.updateJob(job.id, { nextPollAt: new Date(Date.now() + delay).toISOString(), diagnostics: { ...job.diagnostics, pollFailures: failures } }, ACTIVE_STATUSES)) ?? job;
  }

  private async download(job: JobRecord, provider: ReconstructionProvider, costCredits: number | null): Promise<JobRecord> {
    try {
      const outputs = await provider.fetchOutputs({ provider: job.provider, externalId: job.externalId!, submittedAt: job.submittedAt ?? job.createdAt, estimatedCredits: job.estimatedCredits });
      if (!outputs.length) throw new ProviderError(job.provider, "fatal", "no_outputs", "The provider returned no files.");
      const stored: StoredArtifact[] = [];
      for (const output of outputs) {
        const safeName = output.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
        const objectPath = `${job.ownerId}/${job.scanId}/${job.roomId}/${job.provider}/${job.id}/${safeName}`;
        await this.store.putObject(RECONSTRUCTION_BUCKET, objectPath, output.bytes, output.mimeType);
        stored.push(await this.store.insertArtifact({ jobId: job.id, scanId: job.scanId, roomId: job.roomId, ownerId: job.ownerId, provider: job.provider, type: output.type, bucket: RECONSTRUCTION_BUCKET, objectPath, mimeType: output.mimeType, byteSize: output.bytes.byteLength, sha256: sha256Hex(output.bytes), sourceArtifactIds: [], providerJobId: job.externalId, processingVersion: PROCESSING_VERSION, provenance: output.provenance, aiGenerated: output.provenance === "ai_generated" || output.provenance === "mixed", retention: "retained", metadata: { ...(output.metadata ?? {}), inputCount: job.inputCount } }));
        this.log("artifact_downloaded", { traceId: job.traceId, jobId: job.id, provider: job.provider, type: output.type, byteSize: output.bytes.byteLength });
      }
      let balanceAfter: number | null = null;
      try {
        balanceAfter = await provider.balance();
      } catch {}
      const actual = costCredits ?? (job.balanceBefore !== null && balanceAfter !== null ? Math.max(0, job.balanceBefore - balanceAfter) : null);
      this.log("processing_completed", { traceId: job.traceId, jobId: job.id, provider: job.provider, artifacts: stored.length, actualCredits: actual });
      return (await this.store.updateJob(job.id, { status: "ready", actualCredits: actual, balanceAfter, finishedAt: new Date().toISOString(), diagnostics: { ...job.diagnostics, artifactCount: stored.length } }, "downloading")) ?? job;
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : undefined;
      const retryable = providerError ? providerError.retry === "retryable" || providerError.retry === "rate_limited" : false;
      const failures = Number(job.diagnostics.downloadFailures ?? 0) + 1;
      this.log("processing_failed", { traceId: job.traceId, jobId: job.id, provider: job.provider, stage: "download", code: providerError?.code ?? "download_error", failures });
      if (retryable && failures < 5) {
        // Back to processing: the provider still has the outputs; a later poll retries the copy.
        return (await this.store.updateJob(job.id, { status: "processing", nextPollAt: new Date(Date.now() + backoffDelay(failures, { baseMs: 10_000, maxMs: 300_000 })).toISOString(), diagnostics: { ...job.diagnostics, downloadFailures: failures } }, "downloading")) ?? job;
      }
      return (await this.store.updateJob(job.id, { status: "failed", failureCode: providerError?.code ?? "download_failed", failureMessage: "The finished model could not be saved.", finishedAt: new Date().toISOString(), diagnostics: { ...job.diagnostics, downloadFailures: failures } }, "downloading")) ?? job;
    }
  }

  /** Runs due polls; used by the cron route. */
  async pollDue(limit = 10): Promise<JobRecord[]> {
    const due = await this.store.listPollable(limit, new Date().toISOString());
    const results: JobRecord[] = [];
    for (const job of due) results.push(await this.refresh(job.id, { force: true }));
    return results;
  }

  /** Customer-facing view of a room: jobs, artifacts with short-lived URLs, and the combined status. */
  async roomView(ownerId: string, roomId: string) {
    const room = await this.store.getRoom(roomId, ownerId);
    if (!room) throw new ApiError(404, "room_not_found", "The room was not found.");
    const jobs = await Promise.all((await this.store.listJobs({ roomId, ownerId })).map((job) => this.refresh(job.id)));
    const artifacts = await this.store.listArtifacts({ roomId, ownerId });
    const signed = await Promise.all(artifacts.map(async (artifact) => ({ ...publicArtifact(artifact), url: await this.store.signUrl(artifact.bucket, artifact.objectPath, SIGNED_URL_SECONDS).catch(() => null) })));
    return { room: { id: room.id, name: room.name }, status: combinedStatus(jobs), jobs: jobs.map(publicJob), artifacts: signed, urlExpiresInSeconds: SIGNED_URL_SECONDS };
  }
}

export function combinedStatus(jobs: JobRecord[]): JobStatus | "none" {
  if (!jobs.length) return "none";
  const ready = jobs.filter((job) => job.status === "ready").length;
  const active = jobs.some((job) => ACTIVE_STATUSES.includes(job.status));
  if (ready === jobs.length) return "ready";
  if (ready > 0 && !active) return "partially_ready";
  if (active) return jobs.some((job) => job.status === "processing" || job.status === "downloading") ? "processing" : jobs.some((job) => job.status === "queued") ? "queued" : "uploading";
  if (jobs.every((job) => job.status === "expired")) return "expired";
  if (jobs.every((job) => job.status === "cancelled")) return "cancelled";
  return "failed";
}

/** What the browser is allowed to see about a job: no provider ids, no raw provider errors, no balances. */
export function publicJob(job: JobRecord) {
  return { id: job.id, roomId: job.roomId, provider: job.provider, status: job.status, failureCode: job.failureCode, estimatedCredits: job.estimatedCredits, actualCredits: job.actualCredits, createdAt: job.createdAt, updatedAt: job.updatedAt, finishedAt: job.finishedAt, traceId: job.traceId };
}

export function publicArtifact(artifact: StoredArtifact) {
  return { id: artifact.id, roomId: artifact.roomId, provider: artifact.provider, type: artifact.type, mimeType: artifact.mimeType, byteSize: artifact.byteSize, sha256: artifact.sha256, provenance: artifact.provenance, aiGenerated: artifact.aiGenerated, createdAt: artifact.createdAt, name: artifact.objectPath.split("/").pop() ?? artifact.type, metadata: { variant: artifact.metadata.variant ?? null, container: artifact.metadata.container ?? null } };
}
