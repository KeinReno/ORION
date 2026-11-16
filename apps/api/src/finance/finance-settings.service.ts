import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { FinanceMode, FinanceSettings, UpdateFinanceSettingsInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Настройки финансового модуля пространства: простой режим («только доходы и
 * расходы», без счетов) или расширенный (полный набор). Отдельная строка на
 * пространство, а не поле Workspace: модуль можно выключить, не трогая общие
 * настройки. Менять режим может только владелец — как состав модулей и
 * ограничения доступа (тот же контракт, что у knowledge_settings).
 *
 * В простом режиме операции без `accountId` пишутся на авто-созданный счёт
 * «Основной» (`isDefault`). Счёт создаётся лениво при первой такой операции;
 * гонку двух одновременных созданий ловит частичный уникальный индекс
 * `finance_accounts_one_default` — проигравший получает P2002 и перечитывает
 * строку победителя.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Действующий режим; при отсутствии строки — `advanced` (без записи в БД). */
  async readModeTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<FinanceMode> {
    const row = await tx.financeSettings.findUnique({ where: { workspaceId }, select: { mode: true } });
    return row?.mode === "simple" ? "simple" : "advanced";
  }

  get(userId: string, workspaceId: string): Promise<FinanceSettings> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.financeSettings.findUnique({ where: { workspaceId } });
      return toDto(row, workspaceId);
    });
  }

  update(userId: string, workspaceId: string, input: UpdateFinanceSettingsInput): Promise<FinanceSettings> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const row = await tx.financeSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, mode: input.mode },
        update: { mode: input.mode }
      });
      return toDto(row, workspaceId);
    });
  }

  /**
   * Счёт, на который простой режим записывает операцию без `accountId`.
   * Создаётся лениво; P2002 от частичного уникального индекса означает, что
   * параллельный запрос создал счёт первым — перечитываем его строку.
   */
  async resolveDefaultAccountTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
    const existing = await tx.account.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
    if (existing) return existing.id;
    try {
      const created = await tx.account.create({
        data: { workspaceId, name: "Основной", kind: "other", isDefault: true },
        select: { id: true }
      });
      return created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await tx.account.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } });
        if (winner) return winner.id;
      }
      throw error;
    }
  }
}

function toDto(row: { mode: string; updatedAt: Date } | null, workspaceId: string): FinanceSettings {
  return {
    workspaceId,
    mode: row?.mode === "simple" ? "simple" : "advanced",
    updatedAt: (row?.updatedAt ?? new Date(0)).toISOString()
  };
}
