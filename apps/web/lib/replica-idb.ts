import type { ReplicaState, ReplicaStorage } from "@orion/core";

/**
 * Локальная копия пространства в IndexedDB (ADR-0016 §7). Один объект на пару «пользователь + пространство».
 * Копия лежит в открытом виде — защита на уровне шифрования диска ОС (ограничение зафиксировано в ADR).
 * Любая ошибка хранилища (приватное окно, запрет сайта) не ломает приложение: копия просто не сохранится.
 */
const DB_NAME = "orion-replica";
const STORE = "replicas";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB недоступна"));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

const keyOf = (userId: string, workspaceId: string): string => `${userId}:${workspaceId}`;

export function createIdbReplicaStorage(): ReplicaStorage | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async load(userId, workspaceId) {
      try {
        const value = await run<ReplicaState | undefined>("readonly", (store) => store.get(keyOf(userId, workspaceId)));
        return value ?? null;
      } catch {
        return null;
      }
    },
    async save(state) {
      try {
        await run("readwrite", (store) => store.put(state, keyOf(state.userId, state.workspaceId)));
      } catch {
        // Не удалось сохранить на диск — копия остаётся в памяти до закрытия вкладки.
      }
    },
    async clear(userId, workspaceId) {
      try {
        await run("readwrite", (store) => store.delete(keyOf(userId, workspaceId)));
      } catch {
        // нечего стирать
      }
    }
  };
}
