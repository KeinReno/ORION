import { z } from "zod";

/**
 * Обновления приложения с GitHub Releases (приватный репозиторий — доступ по токену владельца).
 * Схемы ответов без `.default(...)`.
 */
export const APP_UPDATE_DEFAULT_REPO = "KeinReno/ORION";

export const appUpdateReleaseSchema = z.object({
  tag: z.string(),
  name: z.string(),
  notes: z.string(),
  publishedAt: z.string().nullable(),
  sizeBytes: z.number().int(),
  /** Контрольная сумма установщика из описания релиза; без неё скачанный файл не применяется. */
  sha256: z.string().nullable()
});
export type AppUpdateRelease = z.infer<typeof appUpdateReleaseSchema>;

export const appUpdateStateSchema = z.enum(["idle", "checking", "up_to_date", "available", "downloading", "ready", "applying", "error"]);
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export const appUpdateStatusSchema = z.object({
  /** Метка сборки (`v0.1.0-windows-beta.3`); `null` — сборка без метки (старая установка или разработка). */
  currentTag: z.string().nullable(),
  currentVersion: z.string(),
  /** Заданы ли репозиторий и токен доступа. */
  configured: z.boolean(),
  /** Можно ли применить обновление: только установленное приложение на Windows. */
  canApply: z.boolean(),
  state: appUpdateStateSchema,
  latest: appUpdateReleaseSchema.nullable(),
  /** 0..1, пока идёт скачивание. */
  progress: z.number().min(0).max(1),
  error: z.string().nullable(),
  lastCheckedAt: z.string().nullable()
});
export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>;

export const appUpdateConfigSchema = z.object({
  repo: z.string(),
  tokenSet: z.boolean(),
  autoCheck: z.boolean()
});
export type AppUpdateConfig = z.infer<typeof appUpdateConfigSchema>;

export const setAppUpdateConfigInputSchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Репозиторий вида владелец/имя")
    .optional(),
  /** Токен GitHub (доступ на чтение к релизам репозитория). `null` — удалить. Обратно не возвращается. */
  token: z.string().trim().min(20, "Токен слишком короткий").max(400).nullable().optional(),
  autoCheck: z.boolean().optional()
});
export type SetAppUpdateConfigInput = z.infer<typeof setAppUpdateConfigInputSchema>;
