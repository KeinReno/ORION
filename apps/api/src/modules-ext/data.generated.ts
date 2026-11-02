// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import type { Prisma } from "@prisma/client";
import type { ModelClassification } from "../sync/snapshot-registry";
import type { SyncClassification } from "../sync/sync-classification";

/** GET-маршрут модуля внутри пространства (`/workspaces/:id` + путь): матричные тесты включения/выключения опрашивают его. */
export const GENERATED_MODULE_PROBES: Record<string, string> = {
  "agent-hub": "/agent-hub/executions",
  "chat-archive": "/chat-archive/conversations",
  "orion-dev": "/development-import/preview",
  "pet-care": "/pet-care/pets"
};

/** Политика снапшота моделей подключаемых модулей (в `SNAPSHOT_MODEL_REGISTRY`). */
export const GENERATED_SNAPSHOT_REGISTRY: ModelClassification[] = [
  {
    "model": "AgentHubExecution",
    "snapshotKey": "agentHubExecutions",
    "policy": "included",
    "reason": "Исполнение — пользовательское долговременное состояние; требуется для восстановления очереди и контрольных точек."
  },
  {
    "model": "AgentHubEvent",
    "snapshotKey": "agentHubEvents",
    "policy": "included",
    "reason": "Неподменяемая история состояния исполнения; события идут после связанных исполнений."
  },
  {
    "model": "AgentHubRuntimeSession",
    "snapshotKey": null,
    "policy": "ephemeral-excluded",
    "reason": "Статус присутствия runtime недостоверен после восстановления из снапшота; не переносить как живую сессию."
  },
  {
    "model": "ChatArchiveConversation",
    "snapshotKey": null,
    "policy": "derived",
    "reason": "Копия внешних транскриптов (~/.claude, ~/.codex), заново импортируется из исходных файлов. В снапшот .orion не входит: архив — сотни МБ, а снапшот собирается в памяти; восстановление пространства архив не трогает."
  },
  {
    "model": "ChatArchiveLine",
    "snapshotKey": null,
    "policy": "derived",
    "reason": "Строки транскрипта — копия исходного файла; в снапшот не входят по той же причине, что и разговор."
  },
  {
    "model": "ChatArchiveAutoSource",
    "snapshotKey": "chatArchiveAutoSources",
    "policy": "included",
    "reason": "Тумблер — сам по себе настройка владельца, не копия чужих данных: пара байт, входит в снапшот как обычная настройка."
  },
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
  { key: "agentHubExecutions", delegate: (tx) => tx.agentHubExecution },
  { key: "agentHubEvents", delegate: (tx) => tx.agentHubEvent },
  { key: "chatArchiveAutoSources", delegate: (tx) => tx.chatArchiveAutoSource },
  { key: "petCarePets", delegate: (tx) => tx.petCarePet },
  { key: "petCareEntries", delegate: (tx) => tx.petCareEntry },
  { key: "petCareDays", delegate: (tx) => tx.petCareDay },
  { key: "petCareEvents", delegate: (tx) => tx.petCareEvent }
];

/** Класс гибридной синхронизации моделей подключаемых модулей (в `SYNC_CLASSIFICATION`). */
export const GENERATED_SYNC_CLASSIFICATION: Record<string, SyncClassification> = {
  "AgentHubExecution": {
    "syncClass": "not-synced",
    "stage": "later",
    "note": "Исполнительские leases и переходы должны координироваться единым узлом; гибридная репликация пока не разрешена."
  },
  "AgentHubEvent": {
    "syncClass": "append-only",
    "stage": "later",
    "note": "После завершения конфликтов синхронизации нужен отдельный протокол консенсуса; текущий источник — локальный хозяин."
  },
  "AgentHubRuntimeSession": {
    "syncClass": "not-synced",
    "stage": "never",
    "note": "Эфемерный lease runtime привязан к конкретному узлу и токену; не копировать между устройствами."
  },
  "ChatArchiveConversation": {
    "syncClass": "not-synced",
    "stage": "never",
    "note": "Копия транскриптов, дописывается импортом с узла, где они лежат; в снапшот не входит — и не синхронизируется."
  },
  "ChatArchiveLine": {
    "syncClass": "not-synced",
    "stage": "never",
    "note": "Строка — неизменяемая копия строки файла; не синхронизируется, как и разговор."
  },
  "ChatArchiveAutoSource": {
    "syncClass": "not-synced",
    "stage": "never",
    "note": "Переключается явным действием в настройках; гибридная репликация до него не доведена (как и у остальных настроек)."
  },
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
