// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { Prisma } from "@prisma/client";
import type { ModelClassification } from "../sync/snapshot-registry";
import type { SyncClassification } from "../sync/sync-classification";

/** GET-маршрут модуля внутри пространства (`/workspaces/:id` + путь): матричные тесты включения/выключения опрашивают его. */
export const GENERATED_MODULE_PROBES: Record<string, string> = {};

/** Политика снапшота моделей подключаемых модулей (в `SNAPSHOT_MODEL_REGISTRY`). */
export const GENERATED_SNAPSHOT_REGISTRY: ModelClassification[] = [];

/** Делегаты для снапшота; порядок — «родитель раньше ребёнка» (в `SNAPSHOT_MODELS`). */
export const GENERATED_SNAPSHOT_SPECS: Array<{ key: string; delegate: (tx: Prisma.TransactionClient) => unknown }> = [
];

/** Класс гибридной синхронизации моделей подключаемых модулей (в `SYNC_CLASSIFICATION`). */
export const GENERATED_SYNC_CLASSIFICATION: Record<string, SyncClassification> = {};
