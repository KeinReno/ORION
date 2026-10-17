import { z } from "zod";
import { healthAppointmentSchema, healthSubjectSchema } from "./health";
import { healthMeasurementKindSchema, healthMeasurementSchema, healthTargetSchema } from "./health-measurements";
import { healthMedicationSchema } from "./health-medications";

/**
 * «Здоровье» → журнал симптомов и сводка по человеку (ADR-0012). Эпизод — это только запись: что, насколько
 * сильно (0–10 по собственной шкале человека), когда началось и закончилось ли. С диагнозами ORION их не связывает.
 */
export const healthSymptomSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  severity: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  triggers: z.string(),
  relief: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type HealthSymptom = z.infer<typeof healthSymptomSchema>;

const severity = z.number().int().min(0).max(10);

export const createHealthSymptomInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    severity,
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().default(null),
    triggers: z.string().max(1000).default(""),
    relief: z.string().max(1000).default(""),
    note: z.string().max(4000).default("")
  })
  .refine((v) => !v.startedAt || !v.endedAt || v.startedAt <= v.endedAt, { message: "Конец раньше начала", path: ["endedAt"] });
export type CreateHealthSymptomInput = z.infer<typeof createHealthSymptomInputSchema>;

export const updateHealthSymptomInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  severity: severity.optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  triggers: z.string().max(1000).optional(),
  relief: z.string().max(1000).optional(),
  note: z.string().max(4000).optional()
});
export type UpdateHealthSymptomInput = z.infer<typeof updateHealthSymptomInputSchema>;

/** Эпизод ещё идёт, если у него нет конца. */
export function symptomOngoing(symptom: Pick<HealthSymptom, "endedAt">): boolean {
  return symptom.endedAt === null;
}

/** Длительность в минутах; для идущего эпизода — до `now`. Отрицательной не бывает. */
export function symptomMinutes(symptom: Pick<HealthSymptom, "startedAt" | "endedAt">, now: Date = new Date()): number {
  const start = new Date(symptom.startedAt).getTime();
  const end = symptom.endedAt ? new Date(symptom.endedAt).getTime() : now.getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60_000)) : 0;
}

// ------------------------------------------------------------------ сводка

/**
 * Всё, что нужно для карточки врача и экстренной карточки, одним ответом и одной проверкой доступа. Собирает сервер:
 * клиент ничего не складывает из частично загруженных списков.
 */
export const healthSummarySchema = z.object({
  generatedAt: z.string(),
  subject: healthSubjectSchema,
  /** Принимаемое сейчас: не в архиве, курс не закончился. */
  medications: z.array(healthMedicationSchema),
  /** По каждому виду, где есть записи: последняя, до пяти последних и личный диапазон. */
  measurements: z.array(z.object({ kind: healthMeasurementKindSchema, latest: healthMeasurementSchema, recent: z.array(healthMeasurementSchema), target: healthTargetSchema.nullable() })),
  upcomingAppointments: z.array(healthAppointmentSchema),
  recentAppointments: z.array(healthAppointmentSchema),
  /** Эпизоды за последние 90 дней и все ещё идущие, свежие первыми. */
  symptoms: z.array(healthSymptomSchema)
});
export type HealthSummary = z.infer<typeof healthSummarySchema>;
