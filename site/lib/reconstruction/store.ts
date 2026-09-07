/**
 * Persistence boundary for reconstruction jobs and artifacts.
 *
 * The job service talks to `JobStore`; production uses the Supabase-backed
 * implementation (service role, server only) and tests use `MemoryJobStore`.
 * Both enforce the same invariants: one job per idempotency key, compare-and-
 * set status transitions, artifacts unique by object path, and webhook event
 * identifiers that can be recorded at most once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactRecord, JobStatus, ProviderId } from "./contract";

export type JobRecord = {
  id: string;
  scanId: string;
  roomId: string;
  ownerId: string;
  provider: ProviderId;
  status: JobStatus;
  idempotencyKey: string;
  externalId: string | null;
  submittedAt: string | null;
  inputKind: "images" | "panorama";
  inputCount: number;
  inputSha256: string;
  wantMesh: boolean;
  estimatedCredits: number | null;
  actualCredits: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  attempts: number;
  nextPollAt: string | null;
  lastPolledAt: string | null;
  providerStatusRaw: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string | null;
  details: Record<string, string | number | null>;
  diagnostics: Record<string, unknown>;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type RoomRow = { id: string; scanId: string; ownerId: string; name: string; ordinal: number; status: string; frameCount: number; captureMode: string | null };
export type FrameRow = { id: string; roomId: string; checkpointIndex: number; yaw: number; pitch: number; targetYaw: number; targetElevation: number; objectPath: string; byteSize: number; mimeType: string; width: number; height: number; confirmedAt: string | null; qualityScore: number | null };

export type ArtifactInsert = Omit<ArtifactRecord, "id" | "createdAt"> & { jobId: string | null };
export type StoredArtifact = ArtifactRecord & { jobId: string | null };

export const RECONSTRUCTION_BUCKET = "reconstruction-artifacts";
export const ORIGINALS_BUCKET = "capture-originals";

export interface JobStore {
  getRoom(roomId: string, ownerId: string): Promise<RoomRow | null>;
  listConfirmedFrames(roomId: string): Promise<FrameRow[]>;
  getObject(bucket: string, path: string): Promise<Uint8Array>;
  putObject(bucket: string, path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  signUrl(bucket: string, path: string, seconds: number): Promise<string>;
  /** Inserts the job or returns the existing job with the same idempotency key. Never creates two. */
  insertJob(job: JobRecord): Promise<{ job: JobRecord; created: boolean }>;
  getJob(id: string): Promise<JobRecord | null>;
  listJobs(filter: { roomId?: string; scanId?: string; ownerId?: string }): Promise<JobRecord[]>;
  listJobsByExternalId(provider: ProviderId, externalId: string): Promise<JobRecord[]>;
  /** Jobs that still need polling, ordered by next_poll_at. */
  listPollable(limit: number, now: string): Promise<JobRecord[]>;
  countJobsSince(ownerId: string, sinceIso: string): Promise<number>;
  /** Compare-and-set: applies `patch` only when the job is still in `expectedStatus`. Returns the updated job or null. */
  updateJob(id: string, patch: Partial<JobRecord>, expectedStatus?: JobStatus | JobStatus[]): Promise<JobRecord | null>;
  insertArtifact(artifact: ArtifactInsert): Promise<StoredArtifact>;
  listArtifacts(filter: { scanId?: string; roomId?: string; jobId?: string; ownerId?: string }): Promise<StoredArtifact[]>;
  /** True when this provider event id was not seen before (and is now recorded). */
  recordWebhookEvent(provider: ProviderId, eventId: string, payloadSha256: string): Promise<boolean>;
  recordUsage(ownerId: string, kind: string): Promise<void>;
  countUsageSince(ownerId: string, kind: string, sinceIso: string): Promise<number>;
}

export const ACTIVE_STATUSES: JobStatus[] = ["validating", "uploading", "queued", "processing", "downloading"];

export function newJobId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// In-memory store for tests and for the local demo without Supabase.
// ---------------------------------------------------------------------------
export class MemoryJobStore implements JobStore {
  rooms = new Map<string, RoomRow>();
  frames = new Map<string, FrameRow[]>();
  objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  jobs = new Map<string, JobRecord>();
  artifacts: StoredArtifact[] = [];
  webhookEvents = new Set<string>();
  usage: Array<{ ownerId: string; kind: string; at: string }> = [];

  async getRoom(roomId: string, ownerId: string) {
    const room = this.rooms.get(roomId);
    return room && room.ownerId === ownerId ? room : null;
  }
  async listConfirmedFrames(roomId: string) {
    return (this.frames.get(roomId) ?? []).filter((frame) => frame.confirmedAt).sort((a, b) => a.checkpointIndex - b.checkpointIndex);
  }
  async getObject(bucket: string, path: string) {
    const object = this.objects.get(`${bucket}/${path}`);
    if (!object) throw new Error(`object not found: ${bucket}/${path}`);
    return object.bytes;
  }
  async putObject(bucket: string, path: string, bytes: Uint8Array, mimeType: string) {
    const key = `${bucket}/${path}`;
    if (!this.objects.has(key)) this.objects.set(key, { bytes, mimeType });
  }
  async signUrl(bucket: string, path: string, seconds: number) {
    return `memory://${bucket}/${path}?expires=${seconds}`;
  }
  async insertJob(job: JobRecord) {
    const existing = [...this.jobs.values()].find((candidate) => candidate.idempotencyKey === job.idempotencyKey);
    if (existing) return { job: existing, created: false };
    this.jobs.set(job.id, { ...job });
    return { job: { ...job }, created: true };
  }
  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }
  async listJobs(filter: { roomId?: string; scanId?: string; ownerId?: string }) {
    return [...this.jobs.values()].filter((job) => (!filter.roomId || job.roomId === filter.roomId) && (!filter.scanId || job.scanId === filter.scanId) && (!filter.ownerId || job.ownerId === filter.ownerId)).map((job) => ({ ...job }));
  }
  async listJobsByExternalId(provider: ProviderId, externalId: string) {
    return [...this.jobs.values()].filter((job) => job.provider === provider && job.externalId === externalId).map((job) => ({ ...job }));
  }
  async listPollable(limit: number, now: string) {
    return [...this.jobs.values()]
      .filter((job) => ACTIVE_STATUSES.includes(job.status) && job.externalId && (!job.nextPollAt || job.nextPollAt <= now))
      .sort((a, b) => (a.nextPollAt ?? "").localeCompare(b.nextPollAt ?? ""))
      .slice(0, limit)
      .map((job) => ({ ...job }));
  }
  async countJobsSince(ownerId: string, sinceIso: string) {
    return [...this.jobs.values()].filter((job) => job.ownerId === ownerId && job.createdAt >= sinceIso).length;
  }
  async updateJob(id: string, patch: Partial<JobRecord>, expectedStatus?: JobStatus | JobStatus[]) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (expectedStatus) {
      const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      if (!expected.includes(job.status)) return null;
    }
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, next);
    return { ...next };
  }
  async insertArtifact(artifact: ArtifactInsert) {
    const existing = this.artifacts.find((candidate) => candidate.objectPath === artifact.objectPath);
    if (existing) return existing;
    const stored: StoredArtifact = { ...artifact, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.artifacts.push(stored);
    return stored;
  }
  async listArtifacts(filter: { scanId?: string; roomId?: string; jobId?: string; ownerId?: string }) {
    return this.artifacts.filter((artifact) => (!filter.scanId || artifact.scanId === filter.scanId) && (!filter.roomId || artifact.roomId === filter.roomId) && (!filter.jobId || artifact.jobId === filter.jobId) && (!filter.ownerId || artifact.ownerId === filter.ownerId));
  }
  async recordWebhookEvent(provider: ProviderId, eventId: string) {
    const key = `${provider}:${eventId}`;
    if (this.webhookEvents.has(key)) return false;
    this.webhookEvents.add(key);
    return true;
  }
  async recordUsage(ownerId: string, kind: string) {
    this.usage.push({ ownerId, kind, at: new Date().toISOString() });
  }
  async countUsageSince(ownerId: string, kind: string, sinceIso: string) {
    return this.usage.filter((row) => row.ownerId === ownerId && row.kind === kind && row.at >= sinceIso).length;
  }
}

// ---------------------------------------------------------------------------
// Supabase implementation (service role). Column names follow the migration in
// supabase/migrations/202609070001_reconstruction.sql.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function toJob(row: Row): JobRecord {
  return {
    id: String(row.id),
    scanId: String(row.scan_id),
    roomId: String(row.room_id),
    ownerId: String(row.owner_id),
    provider: row.provider as ProviderId,
    status: row.status as JobStatus,
    idempotencyKey: String(row.idempotency_key),
    externalId: (row.external_id as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    inputKind: row.input_kind as "images" | "panorama",
    inputCount: Number(row.input_count ?? 0),
    inputSha256: String(row.input_sha256 ?? ""),
    wantMesh: Boolean(row.want_mesh),
    estimatedCredits: row.estimated_credits == null ? null : Number(row.estimated_credits),
    actualCredits: row.actual_credits == null ? null : Number(row.actual_credits),
    balanceBefore: row.balance_before == null ? null : Number(row.balance_before),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    attempts: Number(row.attempts ?? 0),
    nextPollAt: (row.next_poll_at as string | null) ?? null,
    lastPolledAt: (row.last_polled_at as string | null) ?? null,
    providerStatusRaw: (row.provider_status_raw as string | null) ?? null,
    failureCode: (row.failure_code as string | null) ?? null,
    failureMessage: (row.failure_message as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    details: (row.details as JobRecord["details"]) ?? {},
    diagnostics: (row.diagnostics as Record<string, unknown>) ?? {},
    traceId: String(row.trace_id ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

function fromJob(job: Partial<JobRecord>): Row {
  const map: Record<keyof JobRecord, string> = {
    id: "id", scanId: "scan_id", roomId: "room_id", ownerId: "owner_id", provider: "provider", status: "status", idempotencyKey: "idempotency_key", externalId: "external_id", submittedAt: "submitted_at", inputKind: "input_kind", inputCount: "input_count", inputSha256: "input_sha256", wantMesh: "want_mesh", estimatedCredits: "estimated_credits", actualCredits: "actual_credits", balanceBefore: "balance_before", balanceAfter: "balance_after", attempts: "attempts", nextPollAt: "next_poll_at", lastPolledAt: "last_polled_at", providerStatusRaw: "provider_status_raw", failureCode: "failure_code", failureMessage: "failure_message", expiresAt: "expires_at", details: "details", diagnostics: "diagnostics", traceId: "trace_id", createdAt: "created_at", updatedAt: "updated_at", finishedAt: "finished_at",
  };
  const row: Row = {};
  for (const [key, value] of Object.entries(job)) if (value !== undefined && key in map) row[map[key as keyof JobRecord]] = value;
  return row;
}

function toArtifact(row: Row): StoredArtifact {
  return {
    id: String(row.id), scanId: String(row.scan_id), roomId: (row.room_id as string | null) ?? null, ownerId: String(row.owner_id), provider: row.provider as StoredArtifact["provider"], type: row.artifact_type as StoredArtifact["type"], bucket: String(row.bucket_id), objectPath: String(row.object_path), mimeType: String(row.mime_type), byteSize: Number(row.byte_size), sha256: String(row.sha256), sourceArtifactIds: (row.source_artifact_ids as string[]) ?? [], createdAt: String(row.created_at), providerJobId: (row.provider_job_id as string | null) ?? null, processingVersion: String(row.processing_version), provenance: row.provenance as StoredArtifact["provenance"], aiGenerated: Boolean(row.ai_generated), retention: row.retention as StoredArtifact["retention"], metadata: (row.metadata as Record<string, unknown>) ?? {}, jobId: (row.job_id as string | null) ?? null,
  };
}

export class SupabaseJobStore implements JobStore {
  constructor(private readonly admin: SupabaseClient) {}

  async getRoom(roomId: string, ownerId: string) {
    const { data } = await this.admin.from("rooms").select("id,scan_id,owner_id,name,ordinal,status,frame_count,capture_mode").eq("id", roomId).eq("owner_id", ownerId).maybeSingle();
    if (!data) return null;
    return { id: data.id, scanId: data.scan_id, ownerId: data.owner_id, name: data.name, ordinal: data.ordinal, status: data.status, frameCount: data.frame_count ?? 0, captureMode: data.capture_mode ?? null };
  }
  async listConfirmedFrames(roomId: string) {
    const { data, error } = await this.admin.from("capture_frames").select("id,room_id,checkpoint_index,yaw,pitch,target_yaw,target_elevation,object_path,byte_size,mime_type,width,height,confirmed_at,quality_score").eq("room_id", roomId).not("confirmed_at", "is", null).order("checkpoint_index");
    if (error) throw error;
    return (data ?? []).map((row) => ({ id: row.id, roomId: row.room_id, checkpointIndex: row.checkpoint_index, yaw: row.yaw, pitch: row.pitch, targetYaw: row.target_yaw, targetElevation: row.target_elevation, objectPath: row.object_path, byteSize: Number(row.byte_size), mimeType: row.mime_type, width: row.width, height: row.height, confirmedAt: row.confirmed_at, qualityScore: row.quality_score ?? null }));
  }
  async getObject(bucket: string, path: string) {
    const { data, error } = await this.admin.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`object download failed: ${bucket}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  async putObject(bucket: string, path: string, bytes: Uint8Array, mimeType: string) {
    const { error } = await this.admin.storage.from(bucket).upload(path, bytes as unknown as Blob, { contentType: mimeType, upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  }
  async signUrl(bucket: string, path: string, seconds: number) {
    const { data, error } = await this.admin.storage.from(bucket).createSignedUrl(path, seconds);
    if (error || !data) throw new Error("signing failed");
    return data.signedUrl;
  }
  async insertJob(job: JobRecord) {
    const { error } = await this.admin.from("reconstruction_jobs").insert(fromJob(job));
    if (error && error.code !== "23505") throw error;
    const { data } = await this.admin.from("reconstruction_jobs").select("*").eq("idempotency_key", job.idempotencyKey).single();
    return { job: toJob(data), created: !error };
  }
  async getJob(id: string) {
    const { data } = await this.admin.from("reconstruction_jobs").select("*").eq("id", id).maybeSingle();
    return data ? toJob(data) : null;
  }
  async listJobs(filter: { roomId?: string; scanId?: string; ownerId?: string }) {
    let query = this.admin.from("reconstruction_jobs").select("*").order("created_at");
    if (filter.roomId) query = query.eq("room_id", filter.roomId);
    if (filter.scanId) query = query.eq("scan_id", filter.scanId);
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(toJob);
  }
  async listJobsByExternalId(provider: ProviderId, externalId: string) {
    const { data } = await this.admin.from("reconstruction_jobs").select("*").eq("provider", provider).eq("external_id", externalId);
    return (data ?? []).map(toJob);
  }
  async listPollable(limit: number, now: string) {
    const { data, error } = await this.admin.rpc("claim_reconstruction_polls", { p_limit: limit, p_now: now });
    if (error) throw error;
    return ((data as Row[] | null) ?? []).map(toJob);
  }
  async countJobsSince(ownerId: string, sinceIso: string) {
    const { count } = await this.admin.from("reconstruction_jobs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).gte("created_at", sinceIso);
    return count ?? 0;
  }
  async updateJob(id: string, patch: Partial<JobRecord>, expectedStatus?: JobStatus | JobStatus[]) {
    let query = this.admin.from("reconstruction_jobs").update({ ...fromJob(patch), updated_at: new Date().toISOString() }).eq("id", id);
    if (expectedStatus) query = Array.isArray(expectedStatus) ? query.in("status", expectedStatus) : query.eq("status", expectedStatus);
    const { data, error } = await query.select("*").maybeSingle();
    if (error) throw error;
    return data ? toJob(data) : null;
  }
  async insertArtifact(artifact: ArtifactInsert) {
    const row = { scan_id: artifact.scanId, room_id: artifact.roomId, owner_id: artifact.ownerId, job_id: artifact.jobId, provider: artifact.provider, artifact_type: artifact.type, bucket_id: artifact.bucket, object_path: artifact.objectPath, mime_type: artifact.mimeType, byte_size: artifact.byteSize, sha256: artifact.sha256, source_artifact_ids: artifact.sourceArtifactIds, provider_job_id: artifact.providerJobId, processing_version: artifact.processingVersion, provenance: artifact.provenance, ai_generated: artifact.aiGenerated, retention: artifact.retention, metadata: artifact.metadata };
    const { error } = await this.admin.from("artifacts").insert(row);
    if (error && error.code !== "23505") throw error;
    const { data } = await this.admin.from("artifacts").select("*").eq("object_path", artifact.objectPath).single();
    return toArtifact(data);
  }
  async listArtifacts(filter: { scanId?: string; roomId?: string; jobId?: string; ownerId?: string }) {
    let query = this.admin.from("artifacts").select("*").neq("retention", "deleted").order("created_at");
    if (filter.scanId) query = query.eq("scan_id", filter.scanId);
    if (filter.roomId) query = query.eq("room_id", filter.roomId);
    if (filter.jobId) query = query.eq("job_id", filter.jobId);
    if (filter.ownerId) query = query.eq("owner_id", filter.ownerId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(toArtifact);
  }
  async recordWebhookEvent(provider: ProviderId, eventId: string, payloadSha256: string) {
    const { error } = await this.admin.from("webhook_events").insert({ provider, event_id: eventId, payload_sha256: payloadSha256 });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw error;
  }
  async recordUsage(ownerId: string, kind: string) {
    await this.admin.from("usage_events").insert({ owner_id: ownerId, kind });
  }
  async countUsageSince(ownerId: string, kind: string, sinceIso: string) {
    const { count } = await this.admin.from("usage_events").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("kind", kind).gte("created_at", sinceIso);
    return count ?? 0;
  }
}
