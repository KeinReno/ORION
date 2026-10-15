import { z } from "zod";

/**
 * Module «Здоровье» (ADR-0012, docs/HEALTH_MODULE_SPEC.md). Данные принадлежат ЧЕЛОВЕКУ
 * (`HealthSubject`), а не пространству: по умолчанию их видит только он сам (или опекун иждивенца) и те,
 * кому он явно открыл доступ. ORION здесь — журнал и напоминалка: дозировок, диагнозов и «норм» нет.
 */
export const HEALTH_ACCESS_LEVELS = ["own", "write", "read"] as const;
export const healthAccessSchema = z.enum(HEALTH_ACCESS_LEVELS);
export type HealthAccess = z.infer<typeof healthAccessSchema>;

/** Уровни, которые можно выдать другому участнику (`own` не выдаётся). */
export const healthGrantLevelSchema = z.enum(["read", "write"]);
export type HealthGrantLevel = z.infer<typeof healthGrantLevelSchema>;
export const HEALTH_GRANT_LABEL: Record<HealthGrantLevel, string> = { read: "Только просмотр", write: "Ведёт вместе" };

/** Меняет ли уровень записи (визиты, профилактика). `read` — нет. */
export function healthCanWrite(access: HealthAccess): boolean {
  return access === "own" || access === "write";
}

export const healthAllergySchema = z.object({
  substance: z.string().trim().min(1).max(120),
  reaction: z.string().trim().max(240)
});
export type HealthAllergy = z.infer<typeof healthAllergySchema>;

const conditionSchema = z.string().trim().min(1).max(120);

export const healthSubjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** Кем является человек: участник пространства (`self` — это вы) или иждивенец без входа. */
  kind: z.enum(["member", "dependent"]),
  /** Участник пространства, чьи это данные (для `member`). */
  userId: z.string().nullable(),
  guardianUserId: z.string().nullable(),
  name: z.string(),
  birthDate: z.string().nullable(),
  bloodType: z.string(),
  allergies: z.array(healthAllergySchema),
  conditions: z.array(conditionSchema),
  emergencyNote: z.string(),
  /** Что вы можете делать с этим человеком: `own` / `write` / `read`. */
  access: healthAccessSchema,
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type HealthSubject = z.infer<typeof healthSubjectSchema>;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

export const createHealthSubjectInputSchema = z.object({
  /** `member` — «это я» (один на пространство); `dependent` — ребёнок/родитель, которого вы ведёте. */
  kind: z.enum(["member", "dependent"]),
  name: z.string().trim().min(1).max(120),
  birthDate: dateOnly.nullable().default(null),
  bloodType: z.string().trim().max(12).default(""),
  allergies: z.array(healthAllergySchema).max(100).default([]),
  conditions: z.array(conditionSchema).max(100).default([]),
  emergencyNote: z.string().max(2000).default("")
});
export type CreateHealthSubjectInput = z.infer<typeof createHealthSubjectInputSchema>;

export const updateHealthSubjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  birthDate: dateOnly.nullable().optional(),
  bloodType: z.string().trim().max(12).optional(),
  allergies: z.array(healthAllergySchema).max(100).optional(),
  conditions: z.array(conditionSchema).max(100).optional(),
  emergencyNote: z.string().max(2000).optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateHealthSubjectInput = z.infer<typeof updateHealthSubjectInputSchema>;

// ------------------------------------------------------------------- grants

export const healthGrantSchema = z.object({
  subjectId: z.string(),
  granteeUserId: z.string(),
  granteeName: z.string(),
  level: healthGrantLevelSchema,
  createdAt: z.string()
});
export type HealthGrant = z.infer<typeof healthGrantSchema>;

export const putHealthGrantInputSchema = z.object({ level: healthGrantLevelSchema });
export type PutHealthGrantInput = z.infer<typeof putHealthGrantInputSchema>;

// ------------------------------------------------------------- appointments

export const healthAppointmentSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  title: z.string(),
  at: z.string(),
  doctorContactId: z.string().nullable(),
  clinic: z.string(),
  purpose: z.string(),
  questions: z.string(),
  outcome: z.string(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type HealthAppointment = z.infer<typeof healthAppointmentSchema>;

export const createHealthAppointmentInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  at: z.string().datetime(),
  doctorContactId: z.string().nullable().default(null),
  clinic: z.string().trim().max(200).default(""),
  purpose: z.string().max(2000).default(""),
  questions: z.string().max(4000).default("")
});
export type CreateHealthAppointmentInput = z.infer<typeof createHealthAppointmentInputSchema>;

export const updateHealthAppointmentInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  at: z.string().datetime().optional(),
  doctorContactId: z.string().nullable().optional(),
  clinic: z.string().trim().max(200).optional(),
  purpose: z.string().max(2000).optional(),
  questions: z.string().max(4000).optional(),
  outcome: z.string().max(8000).optional(),
  doneAt: z.string().datetime().nullable().optional()
});
export type UpdateHealthAppointmentInput = z.infer<typeof updateHealthAppointmentInputSchema>;

// --------------------------------------------------------------- preventive

export const HEALTH_PREVENTIVE_KINDS = ["checkup", "vaccination", "test", "other"] as const;
export const healthPreventiveKindSchema = z.enum(HEALTH_PREVENTIVE_KINDS);
export type HealthPreventiveKind = z.infer<typeof healthPreventiveKindSchema>;
export const HEALTH_PREVENTIVE_KIND_LABEL: Record<HealthPreventiveKind, string> = {
  checkup: "Осмотр",
  vaccination: "Прививка",
  test: "Анализ",
  other: "Другое"
};

export const healthPreventiveItemSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  kind: healthPreventiveKindSchema,
  everyMonths: z.number().int().nullable(),
  firstDueAt: z.string().nullable(),
  lastDoneAt: z.string().nullable(),
  /** Вычисляется сервером через `preventiveNextDue`; null — срок не задан. */
  nextDueAt: z.string().nullable(),
  note: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type HealthPreventiveItem = z.infer<typeof healthPreventiveItemSchema>;

export const createHealthPreventiveInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: healthPreventiveKindSchema.default("checkup"),
  everyMonths: z.number().int().min(1).max(600).nullable().default(null),
  firstDueAt: dateOnly.nullable().default(null),
  lastDoneAt: dateOnly.nullable().default(null),
  note: z.string().max(2000).default("")
});
export type CreateHealthPreventiveInput = z.infer<typeof createHealthPreventiveInputSchema>;

export const updateHealthPreventiveInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: healthPreventiveKindSchema.optional(),
  everyMonths: z.number().int().min(1).max(600).nullable().optional(),
  firstDueAt: dateOnly.nullable().optional(),
  lastDoneAt: dateOnly.nullable().optional(),
  note: z.string().max(2000).optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateHealthPreventiveInput = z.infer<typeof updateHealthPreventiveInputSchema>;

/** «Выполнено»: сдвигает `lastDoneAt` (по умолчанию — сегодня, день клиента). */
export const markHealthPreventiveDoneInputSchema = z.object({ doneOn: dateOnly.optional() });
export type MarkHealthPreventiveDoneInput = z.infer<typeof markHealthPreventiveDoneInputSchema>;

// ----------------------------------------------------------------- «Сегодня»

export const healthTodaySchema = z.object({
  /** Ближайшие невыполненные визиты (14 дней вперёд и до 7 дней назад, если не отмечены прошедшими). */
  appointments: z.array(healthAppointmentSchema.extend({ subjectName: z.string() })),
  /** Профилактика с просроченным или близким сроком (30 дней). */
  preventive: z.array(healthPreventiveItemSchema.extend({ subjectName: z.string(), status: z.enum(["overdue", "soon"]) }))
});
export type HealthToday = z.infer<typeof healthTodaySchema>;

// ------------------------------------------------------------ чистая логика

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Прибавляет месяцы к дню `YYYY-MM-DD` без «переполнения» (31 янв + 1 мес = 28/29 фев). */
export function addMonthsToDay(day: string, months: number): string {
  const base = parseDay(day);
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Следующий срок: `lastDoneAt + everyMonths`; если ни разу не делали — `firstDueAt`; если делали, но
 * периодичности нет (разовая прививка) — срока нет (null), а не «старый firstDueAt».
 */
export function preventiveNextDue(item: { everyMonths: number | null; firstDueAt: string | null; lastDoneAt: string | null }): string | null {
  if (item.lastDoneAt) return item.everyMonths ? addMonthsToDay(item.lastDoneAt, item.everyMonths) : null;
  return item.firstDueAt;
}

export type PreventiveStatus = "overdue" | "soon" | "ok" | "unscheduled";

export const PREVENTIVE_SOON_DAYS = 30;

/** `today` — день клиента `YYYY-MM-DD`; сравнение по дням, не по моментам. */
export function preventiveStatus(nextDueAt: string | null, today: string): PreventiveStatus {
  if (!nextDueAt) return "unscheduled";
  if (nextDueAt < today) return "overdue";
  const limit = new Date(parseDay(today).getTime() + PREVENTIVE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  return nextDueAt <= limit ? "soon" : "ok";
}
