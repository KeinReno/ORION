import type { Prisma } from "@prisma/client";
import { medicationSlots, type HealthDose } from "@orion/shared-types";

export const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
export const dayString = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Слоты расписания на день вместе с отметками. Одна реализация для «Сегодня» (все люди) и для экрана
 * лекарств одного человека; доступ к `subjectIds` проверяет вызывающий. «По требованию» и архивные не входят.
 */
export async function dosesForDayTx(tx: Prisma.TransactionClient, subjectIds: string[], day: string): Promise<Array<HealthDose & { subjectId: string }>> {
  if (subjectIds.length === 0) return [];
  const [meds, intakes] = await Promise.all([
    tx.healthMedication.findMany({ where: { subjectId: { in: subjectIds }, archivedAt: null, asNeeded: false } }),
    tx.healthIntake.findMany({ where: { subjectId: { in: subjectIds }, day: dayDate(day) } })
  ]);
  const marks = new Map(intakes.map((i) => [`${i.medicationId}|${i.time}`, i.status === "taken" ? ("taken" as const) : ("skipped" as const)]));
  const out: Array<HealthDose & { subjectId: string }> = [];
  for (const med of meds) {
    const schedule = { asNeeded: med.asNeeded, times: med.times, weekdays: med.weekdays, startOn: med.startOn ? dayString(med.startOn) : null, endOn: med.endOn ? dayString(med.endOn) : null };
    for (const time of medicationSlots(schedule, day)) {
      out.push({ subjectId: med.subjectId, medicationId: med.id, name: med.name, form: med.form, dose: med.dose, day, time, status: marks.get(`${med.id}|${time}`) ?? null });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, "ru"));
}
