/**
 * Resumable, concurrency-limited upload of a room's original frames.
 *
 * State lives in IndexedDB (each frame's `upload` ticket/receipt), so a reload
 * mid-upload resumes exactly where it stopped: confirmed frames are skipped,
 * frames with a live ticket retry the same object key, expired tickets get a
 * fresh grant for the *same* frame id (never a second object). Local originals
 * are never deleted here.
 */
import { httpScannerBackend, BackendError, type ScannerBackend, type UploadReceipt, type UploadTicket } from "./contracts";
import { roomFrames, updateFrameUpload, type StoredFrame } from "./db";
import { backoffDelay } from "@/lib/reconstruction/backoff";

export type UploadProgress = { total: number; done: number; failed: number; bytesDone: number; bytesTotal: number; current?: string };
export type UploadOptions = { backend?: ScannerBackend; concurrency?: number; attempts?: number; onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> };

const isReceipt = (upload: StoredFrame["upload"]): upload is UploadReceipt => Boolean(upload && "completedAt" in upload);
const expired = (ticket: UploadTicket) => Date.parse(ticket.expiresAt) - 30_000 < Date.now();

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadFrame(frame: StoredFrame, backend: ScannerBackend, attempts: number, sleep = defaultSleep, signal?: AbortSignal): Promise<UploadReceipt> {
  if (isReceipt(frame.upload)) return frame.upload;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new DOMException("upload aborted", "AbortError");
    try {
      let ticket: UploadTicket | UploadReceipt | undefined = frame.upload && !expired(frame.upload as UploadTicket) ? frame.upload : undefined;
      if (!ticket) {
        ticket = await backend.beginUpload(frame.metadata, frame.jpeg.size);
        await updateFrameUpload(frame, ticket);
      }
      if (isReceipt(ticket)) return ticket;
      const result = await backend.uploadPart(ticket, frame.jpeg, { frameId: frame.id, offset: ticket.offset, size: frame.jpeg.size });
      await updateFrameUpload(frame, result);
      if (isReceipt(result)) return result;
      frame = { ...frame, upload: result };
    } catch (error) {
      lastError = error;
      if (error instanceof BackendError && !error.retryable && error.status !== 409 && error.status !== 429) throw error;
      // A 409 (upload incomplete / stale grant) or 429 gets a fresh grant on the next attempt.
      frame = { ...frame, upload: undefined };
      await sleep(backoffDelay(attempt, { baseMs: 800, maxMs: 15_000 }));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upload failed");
}

/** Uploads every frame of a room that is not confirmed yet. Returns the confirmed object keys in checkpoint order. */
export async function uploadRoom(roomId: string, options: UploadOptions = {}): Promise<{ keys: string[]; failed: string[]; progress: UploadProgress }> {
  const backend = options.backend ?? httpScannerBackend;
  const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 3));
  const attempts = options.attempts ?? 4;
  const frames = await roomFrames(roomId);
  const progress: UploadProgress = { total: frames.length, done: 0, failed: 0, bytesDone: 0, bytesTotal: frames.reduce((n, f) => n + f.jpeg.size, 0) };
  const keys = new Map<string, string>();
  const failed: string[] = [];
  for (const frame of frames) {
    if (isReceipt(frame.upload)) {
      keys.set(frame.id, frame.upload.privateObjectKey);
      progress.done++;
      progress.bytesDone += frame.jpeg.size;
    }
  }
  options.onProgress?.({ ...progress });
  const queue = frames.filter((frame) => !isReceipt(frame.upload));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (options.signal?.aborted) return;
      const frame = queue[cursor++];
      if (!frame) return;
      progress.current = frame.id;
      try {
        const receipt = await uploadFrame(frame, backend, attempts, options.sleep, options.signal);
        keys.set(frame.id, receipt.privateObjectKey);
        progress.done++;
        progress.bytesDone += frame.jpeg.size;
      } catch (error) {
        if (error instanceof BackendError && error.code === "authentication_required") throw error;
        failed.push(frame.id);
        progress.failed++;
      }
      options.onProgress?.({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return { keys: frames.filter((frame) => keys.has(frame.id)).map((frame) => keys.get(frame.id)!), failed, progress };
}
