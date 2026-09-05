import type { FrameMetadata, ProcessingJob, UploadReceipt, UploadTicket } from "./contracts";

export type StoredFrame = { id: string; metadata: FrameMetadata; jpeg: Blob; upload?: UploadTicket | UploadReceipt };
export type Room = { id: string; name: string; status: "capturing" | "processing" | "complete"; captured: number; targetCount: number; panoramaUrl?: string; job?: ProcessingJob };
export type ScanSession = { id: string; createdAt: string; updatedAt: string; activeRoomId: string; startYaw?: number; rooms: Room[] };

const DB = "sodar-scanner-v1";
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
    if (!db.objectStoreNames.contains("frames")) {
      const frames = db.createObjectStore("frames", { keyPath: "id" });
      frames.createIndex("roomId", "metadata.roomId");
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction<T>(storeName: "sessions" | "frames", mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export const saveSession = (session: ScanSession) => transaction("sessions", "readwrite", (s) => s.put({ ...session, updatedAt: new Date().toISOString() }));
export const loadSession = (id: string) => transaction<ScanSession | undefined>("sessions", "readonly", (s) => s.get(id));
export const latestSession = async () => {
  const db = await open();
  return new Promise<ScanSession | undefined>((resolve, reject) => {
    const request = db.transaction("sessions").objectStore("sessions").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]);
    request.onerror = () => reject(request.error);
  });
};
export const saveFrame = (frame: StoredFrame) => transaction("frames", "readwrite", (s) => s.put(frame));
export const deleteFrame = (id: string) => transaction("frames", "readwrite", (s) => s.delete(id));
export const updateFrameUpload = async (frame: StoredFrame, upload: NonNullable<StoredFrame["upload"]>) => saveFrame({ ...frame, upload });
export const roomFrames = async (roomId: string) => {
  const db = await open();
  return new Promise<StoredFrame[]>((resolve, reject) => {
    const request = db.transaction("frames").objectStore("frames").index("roomId").getAll(roomId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
