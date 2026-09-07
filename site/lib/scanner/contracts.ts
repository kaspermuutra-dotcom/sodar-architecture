import type { FieldOfView, Orientation, SphereTarget } from "./sphere";
import type { CaptureMode } from "./plan";

export type Checkpoint = Pick<SphereTarget, "index" | "ring" | "yaw" | "pitch" | "elevation">;
export type FrameMetadata = Orientation & {
  id: string;
  roomId: string;
  sessionId: string;
  fov: FieldOfView;
  timestamp: string;
  checkpoint: Checkpoint;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  captureMode?: CaptureMode;
  stationIndex?: number;
  qualityScore?: number;
  source?: "image_capture" | "video_frame";
};
export type UploadPart = { frameId: string; offset: number; size: number; checksum?: string };
export type UploadTicket = { uploadId: string; frameId: string; privateObjectKey: string; uploadUrl: string; uploadToken: string; offset: number; expiresAt: string };
export type UploadReceipt = { uploadId: string; frameId: string; privateObjectKey: string; completedAt: string };
export type ProcessingStage = "stitch" | "cleanse";
export type ProcessingJobRequest = { sessionId: string; roomId: string; stage: ProcessingStage; inputObjectKeys: string[]; preserveInputs: true; dependsOnJobId?: string };
export type ProcessingJob = { id: string; roomId: string; stage: ProcessingStage; status: "queued" | "running" | "succeeded" | "failed"; outputObjectKey?: string; privatePreviewUrl?: string; error?: string };

export type ProviderId = "kiri" | "marble";
export type ReconstructionEstimate = {
  room: { id: string; name: string; frameCount: number };
  providers: Array<{ provider: ProviderId; available: boolean; reason?: string; estimatedCredits: number | null; note: string; outputs: string[]; disclosure: "faithful_reconstruction" | "generative_completion"; imageCount: number }>;
  limits: { dailyJobsPerUser: number; usedToday: number; maxImagesPerJob: number };
  mode: string;
};
export type PublicJob = { id: string; roomId: string; provider: ProviderId; status: string; failureCode: string | null; estimatedCredits: number | null; actualCredits: number | null; createdAt: string; updatedAt: string; finishedAt: string | null; traceId: string };
export type PublicArtifact = { id: string; roomId: string | null; provider: string; type: string; mimeType: string; byteSize: number; sha256: string; provenance: "captured" | "derived" | "ai_generated" | "mixed"; aiGenerated: boolean; createdAt: string; name: string; url: string | null; metadata: { variant: string | null; container: string | null } };
export type RoomView = { room: { id: string; name: string }; status: string; jobs: PublicJob[]; artifacts: PublicArtifact[]; urlExpiresInSeconds: number };
export type TourLinkRecord = { fromRoomId: string; toRoomId: string; yaw: number; pitch: number; label?: string; confirmed: boolean; reverseYaw?: number };

export interface ScannerBackend {
  createScan(scanId: string, propertyName?: string): Promise<void>;
  createRoom(sessionId: string, roomId: string, name: string, ordinal: number, targetCount: number, captureMode?: CaptureMode): Promise<void>;
  beginUpload(metadata: FrameMetadata, size: number): Promise<UploadTicket | UploadReceipt>;
  uploadPart(ticket: UploadTicket, jpeg: Blob, part: UploadPart): Promise<UploadTicket | UploadReceipt>;
  startJob(request: ProcessingJobRequest): Promise<ProcessingJob>;
  getJob(id: string): Promise<ProcessingJob>;
  getPreview(scanId: string): Promise<{ ready: boolean; manifest: { nodes: Array<{ id: string; name: string; panorama: string }> } | null }>;
  uploadPanorama(scanId: string, roomId: string, kind: "stitched_original" | "coverage_mask" | "ai_completed", file: Blob, meta: { width: number; height: number; coverage: number }): Promise<{ artifactId: string }>;
  estimate(roomId: string, providers?: ProviderId[]): Promise<ReconstructionEstimate>;
  startReconstruction(scanId: string, roomId: string, providers: ProviderId[], options: { wantMesh: boolean }): Promise<{ jobs: PublicJob[]; skipped: Array<{ provider: ProviderId; reason: string }> }>;
  roomView(roomId: string): Promise<RoomView>;
  getLinks(scanId: string): Promise<TourLinkRecord[]>;
  saveLinks(scanId: string, links: TourLinkRecord[]): Promise<TourLinkRecord[]>;
  deleteScan(scanId: string): Promise<void>;
}

export class BackendError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean, readonly traceId?: string) {
    super(message);
    this.name = "BackendError";
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; retryable?: boolean }; traceId?: string; message?: string; error_code?: string } | null;
    const code = body?.error?.code ?? (typeof (body as { error?: unknown })?.error === "string" ? String((body as { error: string }).error) : "request_failed");
    throw new BackendError(response.status, code, body?.error?.message || body?.message || `Request failed (${response.status})`, body?.error?.retryable ?? response.status >= 500, body?.traceId);
  }
  return response.json() as Promise<T>;
}

export async function sessionToken(): Promise<string | null> {
  try {
    const { browserSupabase } = await import("@/lib/supabase/client");
    const { data } = await browserSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export const httpScannerBackend: ScannerBackend = {
  createScan: (scanId, propertyName) => apiFetch("/api/scanner/scans", { method: "POST", body: JSON.stringify({ scanId, propertyName }) }).then(json).then(() => undefined),
  createRoom: (sessionId, roomId, name, ordinal, targetCount, captureMode) => apiFetch("/api/scanner/rooms", { method: "POST", body: JSON.stringify({ scanId: sessionId, roomId, name, ordinal, targetCount, captureMode }) }).then(json).then(() => undefined),
  beginUpload: (metadata, size) => apiFetch("/api/scanner/uploads", { method: "POST", body: JSON.stringify({ metadata, size }) }).then(json<UploadTicket | UploadReceipt>),
  uploadPart: async (ticket, jpeg) => {
    const { browserSupabase } = await import("@/lib/supabase/client");
    const { error } = await browserSupabase().storage.from("capture-originals").uploadToSignedUrl(ticket.privateObjectKey, ticket.uploadToken, jpeg, { contentType: "image/jpeg" });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new BackendError(503, "upload_failed", error.message, true);
    return apiFetch("/api/scanner/uploads/confirm", { method: "POST", body: JSON.stringify({ frameId: ticket.frameId }) }).then(json<UploadReceipt>);
  },
  startJob: (request) => apiFetch("/api/scanner/jobs", { method: "POST", body: JSON.stringify(request) }).then(json<ProcessingJob>),
  getJob: (id) => apiFetch(`/api/scanner/jobs/${encodeURIComponent(id)}`).then(json<ProcessingJob>),
  getPreview: (scanId) => apiFetch(`/api/scanner/scans/${encodeURIComponent(scanId)}/preview`).then(json<{ ready: boolean; manifest: { nodes: Array<{ id: string; name: string; panorama: string }> } | null }>),
  uploadPanorama: async (scanId, roomId, kind, file, meta) => {
    const form = new FormData();
    form.set("scanId", scanId);
    form.set("roomId", roomId);
    form.set("kind", kind);
    form.set("width", String(meta.width));
    form.set("height", String(meta.height));
    form.set("coverage", String(meta.coverage));
    form.set("file", file, kind === "coverage_mask" ? "mask.png" : `${kind}.jpg`);
    return apiFetch("/api/scanner/panoramas", { method: "POST", body: form, headers: {} }, false).then(json<{ artifactId: string }>);
  },
  estimate: (roomId, providers) => apiFetch("/api/reconstruction/estimate", { method: "POST", body: JSON.stringify({ roomId, providers }) }).then(json<ReconstructionEstimate>),
  startReconstruction: (scanId, roomId, providers, options) => apiFetch("/api/reconstruction/jobs", { method: "POST", body: JSON.stringify({ scanId, roomId, providers, wantMesh: options.wantMesh, consent: { aiProcessing: true, paid: true } }) }).then(json<{ jobs: PublicJob[]; skipped: Array<{ provider: ProviderId; reason: string }> }>),
  roomView: (roomId) => apiFetch(`/api/reconstruction/rooms/${encodeURIComponent(roomId)}`).then(json<RoomView>),
  getLinks: (scanId) => apiFetch(`/api/scanner/scans/${encodeURIComponent(scanId)}/links`).then(json<{ links: TourLinkRecord[] }>).then((r) => r.links),
  saveLinks: (scanId, links) => apiFetch(`/api/scanner/scans/${encodeURIComponent(scanId)}/links`, { method: "PUT", body: JSON.stringify({ links }) }).then(json<{ links: TourLinkRecord[] }>).then((r) => r.links),
  deleteScan: (scanId) => apiFetch(`/api/scanner/scans/${encodeURIComponent(scanId)}`, { method: "DELETE", body: JSON.stringify({ confirm: scanId }) }).then(json).then(() => undefined),
};

async function apiFetch(url: string, init: RequestInit = {}, jsonBody = true) {
  const token = await sessionToken();
  if (!token) throw new BackendError(401, "authentication_required", "Sign in to save this scan.", false);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "x-trace-id": crypto.randomUUID(), ...((init.headers as Record<string, string>) ?? {}) };
  if (jsonBody) headers["content-type"] = "application/json";
  return fetch(url, { ...init, headers });
}

export function cleansingJob(sessionId: string, stitch: ProcessingJob): ProcessingJobRequest {
  if (!stitch.outputObjectKey) throw new Error("Stitching must finish before cleansing starts");
  return { sessionId, roomId: stitch.roomId, stage: "cleanse", inputObjectKeys: [stitch.outputObjectKey], preserveInputs: true, dependsOnJobId: stitch.id };
}
