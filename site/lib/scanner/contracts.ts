import type { FieldOfView, Orientation, SphereTarget } from "./sphere";

export type Checkpoint = Pick<SphereTarget, "index" | "ring" | "yaw" | "pitch" | "elevation">;
export type FrameMetadata = Orientation & { id: string; roomId: string; sessionId: string; fov: FieldOfView; timestamp: string; checkpoint: Checkpoint; width: number; height: number; mimeType: "image/jpeg" };
export type UploadPart = { frameId: string; offset: number; size: number; checksum?: string };
export type UploadTicket = { uploadId: string; frameId: string; privateObjectKey: string; uploadUrl: string; uploadToken: string; offset: number; expiresAt: string };
export type UploadReceipt = { uploadId: string; frameId: string; privateObjectKey: string; completedAt: string };
export type ProcessingStage = "stitch" | "cleanse";
export type ProcessingJobRequest = { sessionId: string; roomId: string; stage: ProcessingStage; inputObjectKeys: string[]; preserveInputs: true; dependsOnJobId?: string };
export type ProcessingJob = { id: string; roomId: string; stage: ProcessingStage; status: "queued" | "running" | "succeeded" | "failed"; outputObjectKey?: string; privatePreviewUrl?: string; error?: string };

export interface ScannerBackend {
  createScan(scanId: string): Promise<void>;
  createRoom(sessionId: string, roomId: string, name: string, ordinal: number, targetCount: number): Promise<void>;
  beginUpload(metadata: FrameMetadata, size: number): Promise<UploadTicket>;
  uploadPart(ticket: UploadTicket, jpeg: Blob, part: UploadPart): Promise<UploadTicket | UploadReceipt>;
  startJob(request: ProcessingJobRequest): Promise<ProcessingJob>;
  getJob(id: string): Promise<ProcessingJob>;
  getPreview(scanId: string): Promise<{ ready: boolean; manifest: { nodes: Array<{ id: string; name: string; panorama: string }> } | null }>;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(body?.error?.message || `Request failed (${response.status})`); }
  return response.json() as Promise<T>;
}

export const httpScannerBackend: ScannerBackend = {
  createScan: (scanId) => apiFetch("/api/scanner/scans", { method: "POST", body: JSON.stringify({ scanId }) }).then(() => undefined),
  createRoom: (sessionId, roomId, name, ordinal, targetCount) => apiFetch("/api/scanner/rooms", { method: "POST", body: JSON.stringify({ scanId: sessionId, roomId, name, ordinal, targetCount }) }).then(() => undefined),
  beginUpload: (metadata, size) => apiFetch("/api/scanner/uploads", { method: "POST", body: JSON.stringify({ metadata, size }) }).then(json<UploadTicket>),
  uploadPart: async (ticket, jpeg) => {
    const { browserSupabase } = await import("@/lib/supabase/client");
    const { error } = await browserSupabase().storage.from("capture-originals").uploadToSignedUrl(ticket.privateObjectKey, ticket.uploadToken, jpeg, { contentType: "image/jpeg" });
    if (error && !/already exists/i.test(error.message)) throw error;
    return apiFetch("/api/scanner/uploads/confirm", { method: "POST", body: JSON.stringify({ frameId: ticket.frameId }) }).then(json<UploadReceipt>);
  },
  startJob: (request) => apiFetch("/api/scanner/jobs", { method: "POST", body: JSON.stringify(request) }).then(json<ProcessingJob>),
  getJob: (id) => apiFetch(`/api/scanner/jobs/${encodeURIComponent(id)}`).then(json<ProcessingJob>),
  getPreview: (scanId) => apiFetch(`/api/scanner/scans/${encodeURIComponent(scanId)}/preview`).then(json<{ ready: boolean; manifest: { nodes: Array<{ id: string; name: string; panorama: string }> } | null }>),
};

async function apiFetch(url: string, init: RequestInit = {}) {
  const { browserSupabase } = await import("@/lib/supabase/client");
  const { data } = await browserSupabase().auth.getSession();
  if (!data.session) throw new Error("Sign in before uploading a scan.");
  return fetch(url, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}`, "x-trace-id": crypto.randomUUID(), ...init.headers } });
}

export function cleansingJob(sessionId: string, stitch: ProcessingJob): ProcessingJobRequest {
  if (!stitch.outputObjectKey) throw new Error("Stitching must finish before cleansing starts");
  return { sessionId, roomId: stitch.roomId, stage: "cleanse", inputObjectKeys: [stitch.outputObjectKey], preserveInputs: true, dependsOnJobId: stitch.id };
}
