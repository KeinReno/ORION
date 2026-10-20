import { z } from "zod";

/**
 * Расширения без пересборки (ADR-0022, E2): папка `<каталог расширений>/<id>/` с манифестом `orion.extension.json` и
 * собранным `web.js`. Сервер находит папку, владелец установки подтверждает её один раз, интерфейс загружает код в
 * работающую программу. Подтверждение действует на всю установку (решение владельца 20.10.2026).
 */

export const EXTENSION_MANIFEST_FILE = "orion.extension.json";

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const RANGE_RE = /^(?:\^|~|>=)?\d+\.\d+\.\d+$/;
/** Имя хоста для сетевого доступа через сервер (E3): `api.anthropic.com`, без схемы, пути и порта. */
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Манифест расширения — входные данные (читается с диска), поэтому значения по умолчанию здесь уместны. */
export const extensionManifestSchema = z.object({
  id: z.string().regex(ID_RE, "id в kebab-case: строчные латинские буквы и цифры через дефис").max(60),
  name: z.string().trim().min(1, "name — название для людей").max(80),
  version: z.string().regex(SEMVER_RE, "version — semver вида 1.0.0"),
  description: z.string().trim().max(500).default(""),
  author: z.string().trim().max(80).optional(),
  engines: z.object({
    /** Диапазон версий платформы (`PLATFORM_API_VERSION`), например "^1.1.0". */
    orion: z.string().regex(RANGE_RE, "engines.orion — диапазон вида ^1.1.0")
  }),
  /** Собранный ES-модуль рядом с манифестом. */
  entry: z.string().regex(/^[A-Za-z0-9._-]+\.m?js$/, "entry — имя .js-файла в папке расширения").default("web.js"),
  /** Что расширение просит. Сеть и секреты проверяет сервер (E3); показывается при подтверждении. */
  permissions: z
    .object({
      network: z.array(z.string().regex(HOST_RE, "permissions.network — имена хостов, например api.anthropic.com")).max(20).default([]),
      secrets: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(20).default([]),
      storage: z.boolean().default(false)
    })
    .default({})
});
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

/**
 * - `pending` — найдено, ждёт подтверждения;
 * - `approved` — подтверждено и включено, загружается;
 * - `disabled` — подтверждено, но выключено;
 * - `changed` — файлы изменились после подтверждения (не загружается, пока не подтвердят снова или не включат режим разработчика);
 * - `invalid` — манифест или файл с ошибкой; `incompatible` — не подходит к версии платформы.
 */
export const extensionStatusSchema = z.enum(["pending", "approved", "disabled", "changed", "invalid", "incompatible"]);
export type ExtensionStatus = z.infer<typeof extensionStatusSchema>;

export const extensionPermissionsSchema = z.object({
  network: z.array(z.string()),
  secrets: z.array(z.string()),
  storage: z.boolean()
});

export const extensionInfoSchema = z.object({
  /** id из манифеста, а если он не читается — имя папки. */
  id: z.string(),
  folder: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  author: z.string().nullable(),
  status: extensionStatusSchema,
  /** Почему `invalid`/`incompatible` — понятным текстом. */
  problems: z.array(z.string()),
  /** sha-256 манифеста и файла кода — именно его подтверждают. */
  sha256: z.string().nullable(),
  permissions: extensionPermissionsSchema.nullable(),
  devMode: z.boolean(),
  approvedVersion: z.string().nullable(),
  approvedAt: z.string().nullable(),
  /** Путь к коду относительно API (`/extensions/<id>/web.js?h=…`), только когда расширение загружается. */
  entryPath: z.string().nullable()
});
export type ExtensionInfo = z.infer<typeof extensionInfoSchema>;

export const extensionsStateSchema = z.object({
  /** Расширения работают только в локальном режиме на этом компьютере. */
  available: z.boolean(),
  reason: z.string().nullable(),
  dir: z.string().nullable(),
  /** Растёт при любом изменении в папке или подтверждениях — интерфейс перезагружает расширения по нему. */
  revision: z.number().int(),
  /** Может ли этот пользователь подтверждать и выключать (владеет хотя бы одним пространством). */
  canManage: z.boolean(),
  items: z.array(extensionInfoSchema)
});
export type ExtensionsState = z.infer<typeof extensionsStateSchema>;

export const approveExtensionInputSchema = z.object({
  /** Хеш, который пользователь видел, — защищает от подмены файла между просмотром и подтверждением. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
});
export type ApproveExtensionInput = z.infer<typeof approveExtensionInputSchema>;

export const updateExtensionInputSchema = z
  .object({ enabled: z.boolean().optional(), devMode: z.boolean().optional() })
  .refine((value) => value.enabled !== undefined || value.devMode !== undefined, "нужно enabled или devMode");
export type UpdateExtensionInput = z.infer<typeof updateExtensionInputSchema>;
