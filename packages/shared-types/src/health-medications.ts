import { z } from "zod";

/**
 * «Здоровье» → лекарства (ADR-0012). Доза, форма и расписание — ровно то, что ввёл человек: ORION их не
 * подсказывает и не проверяет (ни дозировок, ни взаимодействий). Приём — отметка на запланированном слоте
 * (`день + время`); слот без отметки просто не отмечен, а «пропущено по времени» вычисляется по часам.
 */
export const MEDICATION_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(MEDICATION_TIME_RE, "Время в формате ЧЧ:ММ");
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

export const intakeStatusSchema = z.enum(["taken", "skipped"]);
export type IntakeStatus = z.infer<typeof intakeStatusSchema>;

export const healthMedicationSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  form: z.string(),
  dose: z.string(),
  times: z.array(z.string()),
  weekdays: z.array(z.number().int()),
  startOn: z.string().nullable(),
  endOn: z.string().nullable(),
  asNeeded: z.boolean(),
  stock: z.number().int().nullable(),
  lowStockAt: z.number().int().nullable(),
  /** Остаток не больше порога (только если остаток ведётся). */
  lowStock: z.boolean(),
  note: z.string(),
  /** За последние 30 дней до вчера включительно: запланировано / принято / пропущено осознанно. */
  adherence: z.object({ planned: z.number().int(), taken: z.number().int(), skipped: z.number().int() }),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type HealthMedication = z.infer<typeof healthMedicationSchema>;

const medicationFields = {
  name: z.string().trim().min(1).max(200),
  form: z.string().trim().max(60),
  dose: z.string().trim().max(120),
  times: z.array(timeSchema).max(12),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  startOn: dayString.nullable(),
  endOn: dayString.nullable(),
  asNeeded: z.boolean(),
  stock: z.number().int().min(0).max(100_000).nullable(),
  lowStockAt: z.number().int().min(0).max(100_000).nullable(),
  note: z.string().max(2000)
};

export const createHealthMedicationInputSchema = z
  .object({
    name: medicationFields.name,
    form: medicationFields.form.default(""),
    dose: medicationFields.dose.default(""),
    times: medicationFields.times.default([]),
    weekdays: medicationFields.weekdays.default([]),
    startOn: medicationFields.startOn.default(null),
    endOn: medicationFields.endOn.default(null),
    asNeeded: medicationFields.asNeeded.default(false),
    stock: medicationFields.stock.default(null),
    lowStockAt: medicationFields.lowStockAt.default(null),
    note: medicationFields.note.default("")
  })
  .refine((v) => v.asNeeded || v.times.length > 0, { message: "Укажите время приёма или отметьте «по требованию»", path: ["times"] })
  .refine((v) => !v.startOn || !v.endOn || v.startOn <= v.endOn, { message: "Конец курса раньше начала", path: ["endOn"] });
export type CreateHealthMedicationInput = z.infer<typeof createHealthMedicationInputSchema>;

export const updateHealthMedicationInputSchema = z
  .object({
    name: medicationFields.name.optional(),
    form: medicationFields.form.optional(),
    dose: medicationFields.dose.optional(),
    times: medicationFields.times.optional(),
    weekdays: medicationFields.weekdays.optional(),
    startOn: medicationFields.startOn.optional(),
    endOn: medicationFields.endOn.optional(),
    asNeeded: medicationFields.asNeeded.optional(),
    stock: medicationFields.stock.optional(),
    lowStockAt: medicationFields.lowStockAt.optional(),
    note: medicationFields.note.optional(),
    archivedAt: z.string().datetime().nullable().optional()
  });
export type UpdateHealthMedicationInput = z.infer<typeof updateHealthMedicationInputSchema>;

export const putHealthIntakeInputSchema = z.object({ day: dayString, time: timeSchema, status: intakeStatusSchema });
export type PutHealthIntakeInput = z.infer<typeof putHealthIntakeInputSchema>;

/** Слот расписания на день вместе с его отметкой (null — ещё не отмечен). */
export const healthDoseSchema = z.object({
  medicationId: z.string(),
  name: z.string(),
  form: z.string(),
  dose: z.string(),
  day: z.string(),
  time: z.string(),
  status: intakeStatusSchema.nullable()
});
export type HealthDose = z.infer<typeof healthDoseSchema>;

// ------------------------------------------------------------ чистая логика

type Schedule = { asNeeded: boolean; times: string[]; weekdays: number[]; startOn: string | null; endOn: string | null };

/** Понедельник = 0 … воскресенье = 6 — как у привычек. */
function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Запланирован ли приём в этот день (курс, дни недели). «По требованию» никогда не запланирован. */
export function medicationScheduledOn(med: Schedule, day: string): boolean {
  if (med.asNeeded || med.times.length === 0) return false;
  if (med.startOn && day < med.startOn) return false;
  if (med.endOn && day > med.endOn) return false;
  return med.weekdays.length === 0 || med.weekdays.includes(weekdayOf(day));
}

/** Времена приёма на день по возрастанию; пусто, если в этот день не запланировано. */
export function medicationSlots(med: Schedule, day: string): string[] {
  return medicationScheduledOn(med, day) ? [...new Set(med.times)].sort() : [];
}

export function addDays(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10);
}

export const ADHERENCE_DAYS = 30;

/**
 * Соблюдение схемы за окно `[from, to]` (включительно): сколько слотов было запланировано, сколько принято и
 * сколько пропущено осознанно. Считаются только отметки, попавшие на реальные слоты расписания.
 */
export function medicationAdherence(
  med: Schedule,
  intakes: Array<{ day: string; time: string; status: string }>,
  from: string,
  to: string
): { planned: number; taken: number; skipped: number } {
  const marks = new Map(intakes.map((i) => [`${i.day}|${i.time}`, i.status]));
  let planned = 0;
  let taken = 0;
  let skipped = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const time of medicationSlots(med, day)) {
      planned += 1;
      const status = marks.get(`${day}|${time}`);
      if (status === "taken") taken += 1;
      else if (status === "skipped") skipped += 1;
    }
  }
  return { planned, taken, skipped };
}

export function isLowStock(stock: number | null, lowStockAt: number | null): boolean {
  return stock !== null && lowStockAt !== null && stock <= lowStockAt;
}

/** Слот ещё впереди или уже прошёл (по локальным дню и времени клиента). */
export function doseTiming(dose: { day: string; time: string }, today: string, nowTime: string): "past" | "upcoming" {
  if (dose.day < today) return "past";
  if (dose.day > today) return "upcoming";
  return dose.time <= nowTime ? "past" : "upcoming";
}
