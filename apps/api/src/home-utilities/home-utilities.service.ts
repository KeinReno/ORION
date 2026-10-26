import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type HomeUtilityMonth as MonthRow, type HomeElectricityTariff as TariffRow } from "@prisma/client";
import {
  utilityChargeSchema, utilityMonthSchema, utilityPeriodSchema, utilityTotals,
  electricityTariffSchema, type ElectricityTariffInput, type PutUtilityMonthInput,
  type ImportUtilityMonthsInput, type PutUtilityPaymentInput
} from "@orion/shared-types";
import { HomeUtilityReferences } from "../home/public/home-utility-references";
import { PrismaService } from "../common/prisma.service";
import { FinanceExpenseReader } from "../finance/public/expense-reader";
import { ModulesService } from "../modules/modules.service";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

type PaymentView = { id: string; transactionId: string; amountMinor: number; note: string; occurredAt: string; valid: boolean };
function monthDto(row: MonthRow, payments: PaymentView[], financeVisible: boolean) {
  const charges = utilityChargeSchema.array().parse(row.charges);
  const totals = utilityTotals({ rentMinor: row.rentMinor, rentConfirmed: row.rentConfirmed, charges });
  const paidMinor = financeVisible ? payments.filter((payment) => payment.valid).reduce((sum, payment) => sum + payment.amountMinor, 0) : null;
  return utilityMonthSchema.parse({
    id: row.id, revision: row.revision, homeId: row.homeId, period: row.period,
    rentMinor: row.rentMinor, rentConfirmed: row.rentConfirmed, charges,
    ...totals, importedUtilityMinor: row.importedUtilityMinor, importedGrandTotalMinor: row.importedGrandTotalMinor,
    paidMinor, remainingMinor: paidMinor === null ? null : totals.confirmedTotalMinor - paidMinor, payments,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  });
}

function tariffDto(row: TariffRow) {
  return electricityTariffSchema.parse({
    id: row.id, meterId: row.meterId, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    rateRub: row.rateRub.toFixed(4), note: row.note, createdAt: row.createdAt.toISOString()
  });
}

function previousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

@Injectable()
export class HomeUtilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly plugins: PluginsService,
    private readonly modules: ModulesService,
    private readonly homes: HomeUtilityReferences,
    private readonly expenses: FinanceExpenseReader
  ) {}

  private async guard(tx: Prisma.TransactionClient, userId: string, workspaceId: string, homeId: string) {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.plugins.assertEnabledTx(tx, userId, workspaceId, "home-utilities");
    const home = await this.homes.activeHomeTx(tx, workspaceId, homeId);
    if (!home) throw new NotFoundException("Объект не найден");
  }

  async months(userId: string, workspaceId: string, homeId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      const rows = await tx.homeUtilityMonth.findMany({ where: { workspaceId, homeId }, orderBy: { period: "desc" } });
      return this.monthDtos(tx, userId, workspaceId, rows);
    });
  }

  async putMonth(userId: string, workspaceId: string, homeId: string, period: string, input: PutUtilityMonthInput) {
    utilityPeriodSchema.parse(period);
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      const existing = await tx.homeUtilityMonth.findUnique({ where: { homeId_period: { homeId, period } } });
      let row: MonthRow;
      if (existing) {
        if (input.expectedRevision !== existing.revision) throw new ConflictException("Месяц изменился в другом окне. Обновите его перед сохранением.");
        const changed = await tx.homeUtilityMonth.updateMany({
          where: { id: existing.id, workspaceId, revision: input.expectedRevision },
          data: { rentMinor: input.rentMinor, rentConfirmed: input.rentConfirmed, charges: input.charges, revision: { increment: 1 } }
        });
        if (!changed.count) throw new ConflictException("Месяц изменился в другом окне. Обновите его перед сохранением.");
        row = await tx.homeUtilityMonth.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        if (input.expectedRevision !== undefined) throw new ConflictException("Месяц был удалён. Обновите страницу.");
        try {
          row = await tx.homeUtilityMonth.create({ data: { workspaceId, homeId, period, rentMinor: input.rentMinor, rentConfirmed: input.rentConfirmed, charges: input.charges } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Месяц уже создан в другом окне. Обновите страницу.");
          throw error;
        }
      }
      return (await this.monthDtos(tx, userId, workspaceId, [row]))[0];
    });
  }

  async copyPrevious(userId: string, workspaceId: string, homeId: string, period: string) {
    utilityPeriodSchema.parse(period);
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      if (await tx.homeUtilityMonth.findUnique({ where: { homeId_period: { homeId, period } }, select: { id: true } })) {
        throw new ConflictException("Этот месяц уже создан");
      }
      const previous = await tx.homeUtilityMonth.findUnique({ where: { homeId_period: { homeId, period: previousPeriod(period) } } });
      if (!previous) throw new NotFoundException("Нет предыдущего месяца для копирования");
      const charges = utilityChargeSchema.array().parse(previous.charges).map((charge) => ({ ...charge, confirmed: false }));
      try {
        const row = await tx.homeUtilityMonth.create({
          data: { workspaceId, homeId, period, rentMinor: previous.rentMinor, rentConfirmed: false, charges }
        });
        return (await this.monthDtos(tx, userId, workspaceId, [row]))[0];
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Месяц уже создан в другом окне. Обновите страницу.");
        throw error;
      }
    });
  }

  async importMonths(userId: string, workspaceId: string, homeId: string, input: ImportUtilityMonthsInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      const periods = input.rows.map((row) => row.period);
      const existing = await tx.homeUtilityMonth.findMany({ where: { homeId, workspaceId, period: { in: periods } }, select: { period: true } });
      const known = new Set(existing.map((row) => row.period));
      const preview = input.rows.map((row) => {
        const totals = utilityTotals({ rentMinor: row.rentMinor, rentConfirmed: false, charges: row.charges.map((charge) => ({ ...charge, confirmed: false })) });
        return {
          period: row.period, exists: known.has(row.period), utilityMinor: totals.utilityMinor, grandTotalMinor: totals.grandTotalMinor,
          utilityDifferenceMinor: row.importedUtilityMinor === null ? null : totals.utilityMinor - row.importedUtilityMinor,
          grandDifferenceMinor: row.importedGrandTotalMinor === null ? null : totals.grandTotalMinor - row.importedGrandTotalMinor
        };
      });
      const fresh = input.rows.filter((row) => !known.has(row.period));
      const created = input.dryRun ? 0 : (await tx.homeUtilityMonth.createMany({
        data: fresh.map((row) => ({
          workspaceId, homeId, period: row.period, rentMinor: row.rentMinor, rentConfirmed: false,
          charges: row.charges.map((charge) => ({ ...charge, confirmed: false })),
          importedUtilityMinor: row.importedUtilityMinor, importedGrandTotalMinor: row.importedGrandTotalMinor
        })), skipDuplicates: true
      })).count;
      return { dryRun: input.dryRun, imported: created, skipped: input.dryRun ? known.size : input.rows.length - created, rows: preview };
    });
  }

  async putPayment(userId: string, workspaceId: string, homeId: string, period: string, input: PutUtilityPaymentInput) {
    utilityPeriodSchema.parse(period);
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "finance");
      const month = await tx.homeUtilityMonth.findUnique({ where: { homeId_period: { homeId, period } } });
      if (!month) throw new NotFoundException("Месяц не найден");
      await tx.$queryRaw`SELECT "id" FROM "home_utility_months" WHERE "id" = ${month.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "finance_transactions" WHERE "id" = ${input.transactionId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      const lockedMonth = await tx.homeUtilityMonth.findUniqueOrThrow({ where: { id: month.id } });
      const [expense] = await this.expenses.byIds(tx, workspaceId, [input.transactionId]);
      if (!expense || expense.type !== "expense" || expense.currency !== "RUB") throw new BadRequestException("Выберите рублёвый расход из этого пространства");
      const charges = utilityChargeSchema.array().parse(lockedMonth.charges);
      const confirmed = utilityTotals({ rentMinor: lockedMonth.rentMinor, rentConfirmed: lockedMonth.rentConfirmed, charges }).confirmedTotalMinor;
      const existingMonth = await tx.homeUtilityPayment.findMany({ where: { monthId: month.id, workspaceId } });
      const allocatedMonth = existingMonth.filter((row) => row.transactionId !== input.transactionId).reduce((sum, row) => sum + row.amountMinor, 0);
      if (allocatedMonth + input.amountMinor > confirmed) throw new ConflictException("Сумма оплат превышает подтверждённые начисления месяца");
      const existingExpense = await tx.homeUtilityPayment.findMany({ where: { transactionId: input.transactionId, workspaceId } });
      const allocatedExpense = existingExpense.filter((row) => row.monthId !== month.id).reduce((sum, row) => sum + row.amountMinor, 0);
      if (allocatedExpense + input.amountMinor > expense.totalMinor) throw new ConflictException("Эта операция уже распределена на другие месяцы");
      await tx.homeUtilityPayment.upsert({
        where: { monthId_transactionId: { monthId: month.id, transactionId: input.transactionId } },
        create: { workspaceId, homeId, monthId: month.id, transactionId: input.transactionId, amountMinor: input.amountMinor },
        update: { amountMinor: input.amountMinor }
      });
      return (await this.monthDtos(tx, userId, workspaceId, [lockedMonth]))[0];
    });
  }

  async removePayment(userId: string, workspaceId: string, homeId: string, period: string, paymentId: string) {
    utilityPeriodSchema.parse(period);
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "finance");
      const month = await tx.homeUtilityMonth.findUnique({ where: { homeId_period: { homeId, period } } });
      if (!month) throw new NotFoundException("Месяц не найден");
      const deleted = await tx.homeUtilityPayment.deleteMany({ where: { id: paymentId, workspaceId, homeId, monthId: month.id } });
      if (!deleted.count) throw new NotFoundException("Связь оплаты не найдена");
      return (await this.monthDtos(tx, userId, workspaceId, [month]))[0];
    });
  }

  private async monthDtos(tx: Prisma.TransactionClient, userId: string, workspaceId: string, rows: MonthRow[]) {
    if (rows.length === 0) return [];
    const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    if (!accessible.has("finance")) return rows.map((row) => monthDto(row, [], false));
    const links = await tx.homeUtilityPayment.findMany({ where: { workspaceId, monthId: { in: rows.map((row) => row.id) } } });
    const transactionIds = [...new Set(links.map((link) => link.transactionId))];
    const [expenses, allLinks] = await Promise.all([
      this.expenses.byIds(tx, workspaceId, transactionIds),
      tx.homeUtilityPayment.findMany({ where: { workspaceId, transactionId: { in: transactionIds } }, select: { transactionId: true, amountMinor: true } })
    ]);
    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const allocated = new Map<string, number>();
    for (const link of allLinks) allocated.set(link.transactionId, (allocated.get(link.transactionId) ?? 0) + link.amountMinor);
    return rows.map((row) => {
      const monthLinks = links.filter((link) => link.monthId === row.id);
      const charges = utilityChargeSchema.array().parse(row.charges);
      const confirmed = utilityTotals({ rentMinor: row.rentMinor, rentConfirmed: row.rentConfirmed, charges }).confirmedTotalMinor;
      const monthOverallocated = monthLinks.reduce((sum, link) => sum + link.amountMinor, 0) > confirmed;
      return monthDto(row, monthLinks.map((link) => {
      const expense = expenseById.get(link.transactionId);
      return {
        id: link.id, transactionId: link.transactionId, amountMinor: link.amountMinor,
        note: expense?.note ?? "Операция недоступна", occurredAt: expense?.occurredAt ?? "",
        valid: Boolean(!monthOverallocated && expense && expense.type === "expense" && expense.currency === "RUB" && (allocated.get(link.transactionId) ?? 0) <= expense.totalMinor)
      };
      }), true);
    });
  }

  async tariffs(userId: string, workspaceId: string, homeId: string, meterId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      await this.electricityMeter(tx, workspaceId, homeId, meterId);
      return (await tx.homeElectricityTariff.findMany({ where: { workspaceId, meterId }, orderBy: { effectiveFrom: "desc" } })).map(tariffDto);
    });
  }

  async addTariff(userId: string, workspaceId: string, homeId: string, meterId: string, input: ElectricityTariffInput) {
    return this.prisma.withUser(userId, async (tx) => {
      await this.guard(tx, userId, workspaceId, homeId);
      await this.electricityMeter(tx, workspaceId, homeId, meterId);
      const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
      if (!Number.isFinite(effectiveFrom.getTime()) || effectiveFrom.toISOString().slice(0, 10) !== input.effectiveFrom) throw new ConflictException("Неверная дата тарифа");
      if (await tx.homeElectricityTariff.findUnique({ where: { meterId_effectiveFrom: { meterId, effectiveFrom } }, select: { id: true } })) throw new ConflictException("На эту дату тариф уже записан");
      return tariffDto(await tx.homeElectricityTariff.create({ data: { workspaceId, meterId, effectiveFrom, rateRub: new Prisma.Decimal(input.rateRub), note: input.note } }));
    });
  }

  private async electricityMeter(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, meterId: string) {
    const meter = await this.homes.electricityMeterTx(tx, workspaceId, homeId, meterId);
    if (!meter) throw new NotFoundException("Электросчётчик не найден");
  }
}
