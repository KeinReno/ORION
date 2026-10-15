import { Injectable, NotFoundException } from "@nestjs/common";
import type { ExchangeRate, UpsertExchangeRateInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/** Rates typed by hand: one per pair per day (a second entry for the same day replaces it). */
@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<ExchangeRate[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeExchangeRate.findMany({ where: { workspaceId }, orderBy: [{ day: "desc" }, { base: "asc" }], take: 1000 });
    });
    return rows.map(toDto);
  }

  async upsert(userId: string, workspaceId: string, input: UpsertExchangeRateInput): Promise<ExchangeRate> {
    const day = new Date(`${input.day}T00:00:00.000Z`);
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeExchangeRate.upsert({
        where: { workspaceId_base_quote_day: { workspaceId, base: input.base, quote: input.quote, day } },
        create: { workspaceId, base: input.base, quote: input.quote, rateMicro: input.rateMicro, day },
        update: { rateMicro: input.rateMicro }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, rateId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.financeExchangeRate.findUnique({ where: { id: rateId } });
      if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Курс не найден");
      await tx.financeExchangeRate.delete({ where: { id: rateId } });
    });
  }
}

function toDto(row: { id: string; workspaceId: string; base: string; quote: string; rateMicro: number; day: Date; createdAt: Date }): ExchangeRate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    base: row.base,
    quote: row.quote,
    rateMicro: row.rateMicro,
    day: row.day.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString()
  };
}
