/**
 * On-device persistence for the scanner (IndexedDB).
 *
 * Every frame is written here *before* it counts as captured, and it is never
 * deleted until the person explicitly starts over or clears the room after the
 * server has confirmed every upload. Sessions carry enough state to resume
 * after a reload, a lock screen, a phone call or a crash: mode, phase, plan
 * start heading, per-room progress, upload progress and reconstruction job ids.
 *
 * Schema v2 adds per-frame quality and thumbnails plus a session index; v1
 * records are read unchanged (fields are optional).
 */
import type { FrameMetadata, ProcessingJob, UploadReceipt, UploadTicket } from "./contracts";
import type { CaptureMode, RoomSize } from "./plan";
import type { Finding, FrameMetrics } from "./quality";
import type { AstraCaptureReview } from "./astra";
import type { CameraCapabilities } from "./camera";

export type StoredFrame = {
  id: string;
  metadata: FrameMetadata;
  jpeg: Blob;
  /** ~192 px JPEG for galleries and the Astra sample; never the original. */
  thumb?: Blob;
  quality?: { metrics: FrameMetrics; findings: Finding[]; score: number };
  /** Set when this frame replaced an earlier capture of the same checkpoint. */
  retakeOf?: string;
  upload?: UploadTicket | UploadReceipt;
  uploadedAt?: string;
};

export type RoomStatus = "capturing" | "review" | "confirmed" | "uploading" | "uploaded" | "processing" | "complete" | "failed";

export type RoomJobs = Partial<Record<"kiri" | "marble", { id: string; status: string; updatedAt: string }>>;

export type Room = {
  id: string;
  name: string;
  floor?: string;
  status: RoomStatus;
  captured: number;
  targetCount: number;
  mode?: CaptureMode;
  size?: RoomSize;
  planStartYaw?: number;
  /** Object URL of the on-device panorama; rebuilt from the panoramas store on load. */
  panoramaUrl?: string;
  panoramaAiUrl?: string;
  /** Legacy stitch job from the Python worker path. */
  job?: ProcessingJob;
  jobs?: RoomJobs;
  uploaded?: number;
  gate?: { blocking: string[]; recommended: string[]; info: string[] };
  review?: AstraCaptureReview;
  reviewOverridden?: boolean;
  confirmedAt?: string;
  camera?: CameraCapabilities;
};

export type ScanSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  activeRoomId: string;
  mode?: CaptureMode;
  propertyName?: string;
  startYaw?: number;
  rooms: Room[];
  consent?: { aiProcessing?: string; paid?: string };
  /** Where the flow was when the session was last saved, for "Continue scan". */
  phase?: string;
  serverKnown?: boolean;
  /** Confirmed doorway links placed by the person (also mirrored to the server). */
  links?: Array<{ fromRoomId: string; toRoomId: string; yaw: number; pitch: number; confirmed: boolean }>;
};

const DB = "sodar-scanner-v1";
const VERSION = 2;

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction!;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      const frames = db.objectStoreNames.contains("frames") ? tx.objectStore("frames") : db.createObjectStore("frames", { keyPath: "id" });
      if (!frames.indexNames.contains("roomId")) frames.createIndex("roomId", "metadata.roomId");
      if (!frames.indexNames.contains("sessionId")) frames.createIndex("sessionId", "metadata.sessionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The scanner database is open in another tab."));
  });

async function transaction<T>(storeName: "sessions" | "frames", mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("transaction aborted"));
    };
  });
}

const stripTransient = (session: ScanSession): ScanSession => ({ ...session, rooms: session.rooms.map(({ panoramaUrl: _p, panoramaAiUrl: _a, ...room }) => room) });

export const saveSession = (session: ScanSession) => transaction("sessions", "readwrite", (s) => s.put({ ...stripTransient(session), updatedAt: new Date().toISOString() }));
export const loadSession = (id: string) => transaction<ScanSession | undefined>("sessions", "readonly", (s) => s.get(id));
export const deleteSession = (id: string) => transaction("sessions", "readwrite", (s) => s.delete(id));
export const listSessions = async (): Promise<ScanSession[]> => {
  const all = await transaction<ScanSession[]>("sessions", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
export const latestSession = async () => (await listSessions())[0];
/** The most recent session that still has work in it (a room not complete, or uploads pending). */
export const unfinishedSession = async () =>
  (await listSessions()).find((session) => session.phase !== "abandoned" && session.rooms.some((room) => room.captured > 0) && (session.rooms.some((room) => room.status !== "complete" && room.status !== "failed") || (session.serverKnown === true && session.rooms.some((room) => room.captured > (room.uploaded ?? 0)))));

export const saveFrame = (frame: StoredFrame) => transaction("frames", "readwrite", (s) => s.put(frame));
export const getFrame = (id: string) => transaction<StoredFrame | undefined>("frames", "readonly", (s) => s.get(id));
export const deleteFrame = (id: string) => transaction("frames", "readwrite", (s) => s.delete(id));
export const updateFrameUpload = async (frame: StoredFrame, upload: NonNullable<StoredFrame["upload"]>) => saveFrame({ ...frame, upload, uploadedAt: "completedAt" in upload ? upload.completedAt : frame.uploadedAt });

export const roomFrames = async (roomId: string): Promise<StoredFrame[]> => {
  const frames = await transaction<StoredFrame[]>("frames", "readonly", (s) => s.index("roomId").getAll(roomId));
  return frames.sort((a, b) => a.metadata.checkpoint.index - b.metadata.checkpoint.index || a.metadata.timestamp.localeCompare(b.metadata.timestamp));
};

/** Metadata only (no blobs) — cheap enough to keep in React state for large rooms. */
export type FrameSummary = { id: string; checkpoint: number; timestamp: string; score?: number; findings?: Finding[]; uploaded: boolean; retakeOf?: string; yaw: number; pitch: number };
export const roomFrameSummaries = async (roomId: string): Promise<FrameSummary[]> =>
  (await roomFrames(roomId)).map((frame) => ({ id: frame.id, checkpoint: frame.metadata.checkpoint.index, timestamp: frame.metadata.timestamp, score: frame.quality?.score, findings: frame.quality?.findings, uploaded: Boolean(frame.upload && "completedAt" in frame.upload), retakeOf: frame.retakeOf, yaw: frame.metadata.yaw, pitch: frame.metadata.pitch }));

export const deleteRoomFrames = async (roomId: string) => {
  for (const frame of await roomFrames(roomId)) await deleteFrame(frame.id);
};

export const sessionFrameCount = async (sessionId: string) => transaction<number>("frames", "readonly", (s) => s.index("sessionId").count(sessionId));

/** Rough on-device storage estimate, for the "free up space" hint. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
