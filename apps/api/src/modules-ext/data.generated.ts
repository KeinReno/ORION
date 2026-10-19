// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { Prisma } from "@prisma/client";
import type { ModelClassification } from "../sync/snapshot-registry";
import type { SyncClassification } from "../sync/sync-classification";

/** GET-маршрут модуля внутри пространства (`/workspaces/:id` + путь): матричные тесты включения/выключения опрашивают его. */
export const GENERATED_MODULE_PROBES: Record<string, string> = {
  "pet-care": "/pet-care/pets"
};

/** Политика снапшота моделей подключаемых модулей (в `SNAPSHOT_MODEL_REGISTRY`). */
export const GENERATED_SNAPSHOT_REGISTRY: ModelClassification[] = [
  {
    "model": "PetCarePet",
    "snapshotKey": "petCarePets",
    "policy": "included",
    "reason": "Питомцы — пользовательский контент модуля; вставляются раньше записей ухода, которые на них ссылаются."
  },
  {
    "model": "PetCareEntry",
    "snapshotKey": "petCareEntries",
    "policy": "included",
    "reason": "Журнал ухода — пользовательский контент; после питомцев (petId)."
  },
  {
    "model": "PetCareDay",
    "snapshotKey": "petCareDays",
    "policy": "included",
    "reason": "Дневник самочувствия — пользовательский контент; после питомцев (petId). День один на (питомец, дата)."
  },
  {
    "model": "PetCareEvent",
    "snapshotKey": "petCareEvents",
    "policy": "included",
    "reason": "События питомца — пользовательский контент; после питомцев (petId)."
  }
];

/** Делегаты для снапшота; порядок — «родитель раньше ребёнка» (в `SNAPSHOT_MODELS`). */
export const GENERATED_SNAPSHOT_SPECS: Array<{ key: string; delegate: (tx: Prisma.TransactionClient) => unknown }> = [
  { key: "petCarePets", delegate: (tx) => tx.petCarePet },
  { key: "petCareEntries", delegate: (tx) => tx.petCareEntry },
  { key: "petCareDays", delegate: (tx) => tx.petCareDay },
  { key: "petCareEvents", delegate: (tx) => tx.petCareEvent }
];

/** Класс гибридной синхронизации моделей подключаемых модулей (в `SYNC_CLASSIFICATION`). */
export const GENERATED_SYNC_CLASSIFICATION: Record<string, SyncClassification> = {
  "PetCarePet": {
    "syncClass": "lww-fields",
    "stage": "later",
    "note": "Поля питомца — LWW по полю; офлайн-запись не включена."
  },
  "PetCareEntry": {
    "syncClass": "append-only",
    "stage": "later",
    "note": "Запись ухода — факт: добавляется, не правится; дубли гасит естественный ключ клиента."
  },
  "PetCareDay": {
    "syncClass": "lww-fields",
    "stage": "later",
    "note": "Запись дня заменяется целиком (PUT по (petId, day)); офлайн-запись не включена."
  },
  "PetCareEvent": {
    "syncClass": "append-only",
    "stage": "later",
    "note": "Событие — факт: добавляется и удаляется, не правится."
  }
};
