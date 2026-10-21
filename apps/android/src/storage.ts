import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SnapshotStorage } from "@orion/mobile-core";

interface NativeStore {
  read(): Promise<{ value: string | null }>;
  write(options: { value: string }): Promise<void>;
}
const native = registerPlugin<NativeStore>("OrionStorage");

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kaiden-android-local", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Закройте другие вкладки приложения и повторите"));
    request.onsuccess = () => resolve(request.result);
  });
}

export const storage: SnapshotStorage = Capacitor.isNativePlatform() ? {
  read: async () => (await native.read()).value,
  write: async (value) => native.write({ value }),
} : {
  async read() {
    const db = await openDatabase();
    return new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly");
      const request = tx.objectStore("snapshots").get("local");
      tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  },
  async write(value) {
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(value, "local");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  },
};
