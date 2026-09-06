/**
 * Stitched panoramas persisted on the device, keyed by room id. Kept in its own
 * IndexedDB database so the frames/sessions schema in db.ts stays untouched.
 */
export type StoredPanorama = { roomId: string; sessionId: string; panorama: Blob; mask: Blob; coverage: number; width: number; height: number; filled?: boolean; createdAt: string };

const DB = "sodar-panoramas-v1";

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("panoramas")) {
        const store = db.createObjectStore("panoramas", { keyPath: "roomId" });
        store.createIndex("sessionId", "sessionId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction("panoramas", mode);
    const r = fn(t.objectStore("panoramas"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}

export const savePanorama = (p: StoredPanorama) => tx("readwrite", (s) => s.put(p));
export const loadPanorama = (roomId: string) => tx<StoredPanorama | undefined>("readonly", (s) => s.get(roomId));
export const sessionPanoramas = (sessionId: string) => tx<StoredPanorama[]>("readonly", (s) => s.index("sessionId").getAll(sessionId));
export const deletePanorama = (roomId: string) => tx("readwrite", (s) => s.delete(roomId));
