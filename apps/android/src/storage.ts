import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SnapshotStorage } from "@orion/mobile-core";

interface NativeStore {
  read(): Promise<{ value: string | null }>;
  write(options: { value: string }): Promise<void>;
  readReplica(options: { scope: string }): Promise<{ value: string | null }>;
  writeReplica(options: { scope: string; value: string }): Promise<void>;
  clearReplica(options: { scope: string }): Promise<void>;
  clearAllReplicas(): Promise<void>;
}
const native = registerPlugin<NativeStore>("OrionStorage");

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kaiden-android-local", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots");
      if (!request.result.objectStoreNames.contains("replicas")) request.result.createObjectStore("replicas");
    };
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

async function replicaTransaction(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("replicas", mode);
    const request = work(tx.objectStore("replicas"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export const replicaIO = Capacitor.isNativePlatform() ? {
  read: async (scope: string) => (await native.readReplica({ scope })).value,
  write: async (scope: string, value: string) => native.writeReplica({ scope, value }),
  clear: async (scope: string) => native.clearReplica({ scope }),
  clearAll: async () => native.clearAllReplicas(),
} : {
  read: async (scope: string) => (await replicaTransaction("readonly", (store) => store.get(scope)) ?? null) as string | null,
  write: async (scope: string, value: string) => { await replicaTransaction("readwrite", (store) => store.put(value, scope)); },
  clear: async (scope: string) => { await replicaTransaction("readwrite", (store) => store.delete(scope)); },
  clearAll: async () => { await replicaTransaction("readwrite", (store) => store.clear()); },
};
