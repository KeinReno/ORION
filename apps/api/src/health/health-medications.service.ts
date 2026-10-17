import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { HealthMedication as MedicationRow } from "@prisma/client";
import {
  ADHERENCE_DAYS,
  addDays,
  createHealthMedicationInputSchema,
  isLowStock,
  medicationAdherence,
  type CreateHealthMedicationInput,
  type HealthDose,
  type HealthMedication,
  type PutHealthIntakeInput,
  type UpdateHealthMedicationInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { dayDate, dayString, dosesForDayTx } from "./health-doses";
import { HealthService } from "./health.service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayOr = (value?: string): string => (value && DAY_RE.test(value) ? value : dayString(new Date()));

/**
 * Лекарства и приёмы (ADR-0012). Доступ — тот же `assertSubjectTx`, что и у остального модуля: смотреть может
 * любой допущенный, менять — `own`/`write`. ORION не подсказывает и не проверяет ни дозу, ни сочетания.
 */
@Injectable()
export class HealthMedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService
  ) {}

  async list(userId: string, workspaceId: string, subjectId: string, todayInput?: string, archived = false): Promise<HealthMedication[]> {
    const today = todayOr(todayInput);
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const rows = await tx.healthMedication.findMany({ where: { subjectId, archivedAt: archived ? { not: null } : null }, orderBy: { createdAt: "asc" }, take: 300 });
      // Окно соблюдения: 30 дней, заканчивая вчерашним — сегодняшние слоты ещё могут быть впереди.
      const to = addDays(today, -1);
      const from = addDays(today, -ADHERENCE_DAYS);
      const intakes = await tx.healthIntake.findMany({ where: { subjectId, day: { gte: dayDate(from), lte: dayDate(to) } }, select: { medicationId: true, day: true, time: true, status: true } });
      return rows.map((row) =>
        medicationDto(row, medicationAdherence(scheduleOf(row), intakes.filter((i) => i.medicationId === row.id).map((i) => ({ day: dayString(i.day), time: i.time, status: i.status })), from, to))
      );
    });
  }

  async create(userId: string, workspaceId: string, subjectId: string, input: CreateHealthMedicationInput): Promise<HealthMedication> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const row = await tx.healthMedication.create({
        data: {
          workspaceId,
          subjectId,
          name: input.name,
          form: input.form,
          dose: input.dose,
          times: [...new Set(input.times)].sort(),
          weekdays: [...new Set(input.weekdays)].sort(),
          startOn: input.startOn ? dayDate(input.startOn) : null,
          endOn: input.endOn ? dayDate(input.endOn) : null,
          asNeeded: input.asNeeded,
          stock: input.stock,
          lowStockAt: input.lowStockAt,
          note: input.note
        }
      });
      return medicationDto(row, { planned: 0, taken: 0, skipped: 0 });
    });
  }

  async update(userId: string, workspaceId: string, subjectId: string, medicationId: string, input: UpdateHealthMedicationInput): Promise<HealthMedication> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const current = await this.medicationTx(tx, subjectId, medicationId);
      // Итог после правки должен остаться осмысленным: график либо «по требованию», конец курса не раньше начала.
      const merged = {
        name: input.name ?? current.name,
        form: input.form ?? current.form,
        dose: input.dose ?? current.dose,
        times: input.times ?? current.times,
        weekdays: input.weekdays ?? current.weekdays,
        startOn: input.startOn !== undefined ? input.startOn : current.startOn ? dayString(current.startOn) : null,
        endOn: input.endOn !== undefined ? input.endOn : current.endOn ? dayString(current.endOn) : null,
        asNeeded: input.asNeeded ?? current.asNeeded,
        stock: input.stock !== undefined ? input.stock : current.stock,
        lowStockAt: input.lowStockAt !== undefined ? input.lowStockAt : current.lowStockAt,
        note: input.note ?? current.note
      };
      const check = createHealthMedicationInputSchema.safeParse(merged);
      if (!check.success) throw new BadRequestException(check.error.issues[0]?.message ?? "Некорректные данные");
      const row = await tx.healthMedication.update({
        where: { id: medicationId },
        data: {
          name: merged.name,
          form: merged.form,
          dose: merged.dose,
          times: [...new Set(merged.times)].sort(),
          weekdays: [...new Set(merged.weekdays)].sort(),
          startOn: merged.startOn ? dayDate(merged.startOn) : null,
          endOn: merged.endOn ? dayDate(merged.endOn) : null,
          asNeeded: merged.asNeeded,
          stock: merged.stock,
          lowStockAt: merged.lowStockAt,
          note: merged.note,
          ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt === null ? null : new Date(input.archivedAt) } : {})
        }
      });
      return medicationDto(row, { planned: 0, taken: 0, skipped: 0 });
    });
  }

  /** Слоты на день с отметками для одного человека. */
  async schedule(userId: string, workspaceId: string, subjectId: string, dayInput?: string): Promise<HealthDose[]> {
    const day = todayOr(dayInput);
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      return (await dosesForDayTx(tx, [subjectId], day)).map(({ subjectId: _subject, ...dose }) => dose);
    });
  }

  /**
   * Отметка приёма. Идемпотентна по (лекарство, день, время). Остаток уменьшается при переходе в «принято» и
   * возвращается, если отметку меняют на «пропущено»; всё в одной транзакции, остаток не уходит ниже нуля.
   */
  async putIntake(userId: string, workspaceId: string, subjectId: string, medicationId: string, input: PutHealthIntakeInput): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const medication = await this.medicationTx(tx, subjectId, medicationId);
      const day = dayDate(input.day);
      const existing = await tx.healthIntake.findUnique({ where: { medicationId_day_time: { medicationId, day, time: input.time } } });
      if (existing?.status === input.status) return;
      await tx.healthIntake.upsert({
        where: { medicationId_day_time: { medicationId, day, time: input.time } },
        create: { workspaceId, subjectId, medicationId, day, time: input.time, status: input.status },
        update: { status: input.status }
      });
      await this.adjustStockTx(tx, medication, existing?.status === "taken" ? 1 : 0, input.status === "taken" ? -1 : 0);
    });
  }

  /** Снять отметку (вернуть слот в «не отмечен»). */
  async removeIntake(userId: string, workspaceId: string, subjectId: string, medicationId: string, dayInput: string, time: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const medication = await this.medicationTx(tx, subjectId, medicationId);
      if (!DAY_RE.test(dayInput)) throw new BadRequestException("Дата в формате ГГГГ-ММ-ДД");
      const existing = await tx.healthIntake.findUnique({ where: { medicationId_day_time: { medicationId, day: dayDate(dayInput), time } } });
      if (!existing) return;
      await tx.healthIntake.delete({ where: { id: existing.id } });
      await this.adjustStockTx(tx, medication, existing.status === "taken" ? 1 : 0, 0);
    });
  }

  // ---------------------------------------------------------------- helpers

  private async medicationTx(tx: Parameters<Parameters<PrismaService["withUser"]>[1]>[0], subjectId: string, medicationId: string): Promise<MedicationRow> {
    const row = await tx.healthMedication.findUnique({ where: { id: medicationId } });
    if (!row || row.subjectId !== subjectId) throw new NotFoundException("Лекарство не найдено");
    return row;
  }

  /** `give` возвращает единицы в остаток, `take` (отрицательное) списывает; ведётся только если остаток задан. */
  private async adjustStockTx(tx: Parameters<Parameters<PrismaService["withUser"]>[1]>[0], medication: MedicationRow, give: number, take: number): Promise<void> {
    if (medication.stock === null) return;
    const delta = give + take;
    if (delta === 0) return;
    if (delta > 0) await tx.healthMedication.update({ where: { id: medication.id }, data: { stock: { increment: delta } } });
    else await tx.healthMedication.updateMany({ where: { id: medication.id, stock: { gt: 0 } }, data: { stock: { decrement: -delta } } });
  }
}

function scheduleOf(row: MedicationRow) {
  return { asNeeded: row.asNeeded, times: row.times, weekdays: row.weekdays, startOn: row.startOn ? dayString(row.startOn) : null, endOn: row.endOn ? dayString(row.endOn) : null };
}

export function medicationDto(row: MedicationRow, adherence: { planned: number; taken: number; skipped: number }): HealthMedication {
  return {
    id: row.id,
    subjectId: row.subjectId,
    name: row.name,
    form: row.form,
    dose: row.dose,
    times: [...row.times].sort(),
    weekdays: [...row.weekdays].sort(),
    startOn: row.startOn ? dayString(row.startOn) : null,
    endOn: row.endOn ? dayString(row.endOn) : null,
    asNeeded: row.asNeeded,
    stock: row.stock,
    lowStockAt: row.lowStockAt,
    lowStock: isLowStock(row.stock, row.lowStockAt),
    note: row.note,
    adherence,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
