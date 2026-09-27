import { z } from "zod";

/**
 * ORION — синхронизация и бэкап через облако (WebDAV). Полный разбор и
 * архитектура — `docs/SYNC.md`. Здесь — контракт Стадии 1 (бэкап /
 * восстановление одной ноды в один WebDAV-каталог) плюс форма «ссылки на
 * подключение» из Стадии 3, чтобы её тип был готов заранее.
 *
 * Источник истины — эти zod-схемы; DTO-типы выводятся через `z.infer`,
 * руками не дублируются (как в остальных `shared-types`).
 */

// ---------------------------------------------------------------------------
// Удалённое хранилище (WebDAV)
// ---------------------------------------------------------------------------

/** Пока единственный вид удалёнки. S3/Dropbox добавятся тем же паттерном. */
export const syncRemoteKindSchema = z.enum(["webdav"]);
export type SyncRemoteKind = z.infer<typeof syncRemoteKindSchema>;

export const syncEncAlgoSchema = z.enum(["rclone-base64", "openssl-base64", "none"]);
export type SyncEncAlgo = z.infer<typeof syncEncAlgoSchema>;

/**
 * Настройка удалёнки, как её отдаём наружу: **без пароля**. Пароль уходит
 * только на вход (`syncRemoteInputSchema`) и хранится в БД зашифрованным
 * (`SyncRemote.passwordEnc`, ключ — `SYNC_SECRET` из `.env`).
 */
export const syncRemoteSchema = z.object({
  workspaceId: z.string(),
  kind: syncRemoteKindSchema,
  url: z.string().url(),
  username: z.string(),
  /** Есть ли сохранённый пароль (сам он наружу не отдаётся). */
  hasPassword: z.boolean(),
  baseDir: z.string(),
  /**
   * `false` — сервер не поддерживает `PROPFIND Depth: infinity` (Mail.ru
   * Cloud), листинг идёт обходом по уровням. См. `docs/SYNC.md` §1.2.
   */
  depthInfinity: z.boolean(),
  encAlgo: syncEncAlgoSchema,
  /** Интервал автобэкапа в мс; `-1` — выключено (семантика Remotely Save). */
  autoEveryMs: z.number().int(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable()
});
export type SyncRemote = z.infer<typeof syncRemoteSchema>;

export const syncRemoteInputSchema = z.object({
  kind: syncRemoteKindSchema.default("webdav"),
  url: z.string().url("Нужен полный адрес WebDAV, напр. https://webdav.cloud.mail.ru"),
  username: z.string().max(200).default(""),
  /**
   * Пустая строка — «не менять сохранённый пароль». Так форма настроек может
   * присылать себя целиком, не зная текущего пароля.
   */
  password: z.string().max(500).default(""),
  baseDir: z
    .string()
    .max(200)
    .default("/ORION")
    .refine((v) => v.startsWith("/"), "Путь должен начинаться с /"),
  depthInfinity: z.boolean().default(true),
  encAlgo: syncEncAlgoSchema.default("rclone-base64"),
  autoEveryMs: z.number().int().min(-1).default(-1)
});
export type SyncRemoteInput = z.infer<typeof syncRemoteInputSchema>;

/** Результат «Проверить соединение» — PROPFIND базовой папки. */
export const syncRemoteTestResultSchema = z.object({
  ok: z.boolean(),
  /** Человекочитаемое: «Подключено, в папке 12 объектов» или текст ошибки. */
  detail: z.string()
});
export type SyncRemoteTestResult = z.infer<typeof syncRemoteTestResultSchema>;

// ---------------------------------------------------------------------------
// Бэкапы (Стадия 1)
// ---------------------------------------------------------------------------

/** Один снапшот, лежащий на удалёнке в `<baseDir>/<workspaceId>/snapshots/`. */
export const backupRefSchema = z.object({
  /** Имя файла, оно же ключ для restore: `2026-09-08T12-00-00-000Z.orion`. */
  name: z.string(),
  sizeBytes: z.number().int(),
  /** ISO — момент создания (из имени файла, не mtime удалёнки). */
  createdAt: z.string()
});
export type BackupRef = z.infer<typeof backupRefSchema>;

export const backupResultSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int(),
  /** Сколько строк вошло в снапшот, по модулям — для строки-подтверждения. */
  counts: z.record(z.string(), z.number().int())
});
export type BackupResult = z.infer<typeof backupResultSchema>;

export const restoreInputSchema = z.object({
  /** Имя снапшота из `GET /sync/backups`; пропущено — берётся `latest`. */
  snapshot: z.string().optional(),
  /**
   * `true` (по умолчанию) — только посчитать и вернуть превью, ничего не
   * писать в БД. Клиент показывает превью и повторяет запрос с `false`.
   */
  dryRun: z.boolean().default(true),
  /**
   * Обязателен при `dryRun: false` — защита от случайного затирания рабочих
   * данных. Клиент подставляет `workspaceId`.
   */
  confirmWorkspaceId: z.string().optional(),
  /**
   * Обязателен при `dryRun: false` (S04, stale-preview rejection) —
   * `manifestHash` из ответа предпросмотра (`RestorePreview.manifestHash`).
   * `apply` скачивает файл с удалёнки заново и сверяет свежий hash с этим —
   * если они разошлись (кто-то успел сделать новый бэкап между preview и
   * apply), apply отказывает вместо того, чтобы тихо применить план, который
   * пользователь не видел в превью.
   */
  expectedManifestHash: z.string().optional()
});
export type RestoreInput = z.infer<typeof restoreInputSchema>;

export const restorePreviewSchema = z.object({
  snapshot: z.string(),
  createdAt: z.string(),
  /** Что лежит в снапшоте — по модулям. */
  incoming: z.record(z.string(), z.number().int()),
  /** Что сейчас в БД — по тем же модулям (что будет заменено). */
  current: z.record(z.string(), z.number().int()),
  applied: z.boolean(),
  /**
   * sha256 зашифрованных байт файла снапшота на удалёнке в момент этого
   * вызова (и preview, и apply читают его одинаково — см. `SyncService.restore`).
   * Клиент обязан вернуть это значение в `RestoreInput.expectedManifestHash`
   * при `dryRun: false` (stale-preview rejection, S04).
   */
  manifestHash: z.string()
});
export type RestorePreview = z.infer<typeof restorePreviewSchema>;

// ---------------------------------------------------------------------------
// «Ссылка на подключение» (Стадия 3 — тип готовим заранее)
// ---------------------------------------------------------------------------

/** Один селектор данных внутри шары: модуль целиком либо его срез. */
export const shareSelectorSchema = z.object({
  module: z.enum(["note", "task", "event", "finance", "document"]),
  /** Пусто — весь модуль. Иначе фильтр вида `{ tagsAny: [...] }`, `{ projectTag: "X" }`. */
  filter: z.record(z.string(), z.unknown()).default({})
});
export type ShareSelector = z.infer<typeof shareSelectorSchema>;

export const connectionLinkSchema = z.object({
  v: z.literal(1),
  workspaceId: z.string(),
  peer: z.object({ id: z.string(), displayName: z.string() }),
  remote: z.object({
    kind: syncRemoteKindSchema,
    url: z.string().url(),
    username: z.string(),
    password: z.string(),
    baseDir: z.string(),
    depthInfinity: z.boolean()
  }),
  /** Приватный ключ этого участника (ed25519, base64url) — для подписи выгрузок. */
  peerPrivateKey: z.string(),
  grants: z.array(
    z.object({
      shareId: z.string(),
      name: z.string(),
      perms: z.enum(["read", "write"]),
      /** Ключ шары (base64url), которым расшифровывается её содержимое. */
      key: z.string(),
      keyVersion: z.number().int()
    })
  ),
  encAlgo: syncEncAlgoSchema
});
export type ConnectionLink = z.infer<typeof connectionLinkSchema>;

/** Префикс блоба «ссылки»: `ORION1.<base64url(зашифрованный JSON)>`. */
export const CONNECTION_LINK_PREFIX = "ORION1.";
