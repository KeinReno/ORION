import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  KNOWLEDGE_DEFAULT_REVISION_LIMIT,
  KNOWLEDGE_DEFAULT_VERIFICATION_DAYS,
  type KnowledgeSettings,
  type UpdateKnowledgeSettingsInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { KnowledgeSettingsValues } from "./knowledge-dto";

/**
 * Настройки базы знаний пространства (задание 06): через сколько дней проверка
 * считается просроченной и сколько версий материала хранить. Отдельная строка на
 * пространство, а не поле Workspace: модуль можно выключить, не трогая общие настройки.
 * Менять может только владелец — как состав модулей и ограничения доступа.
 */
@Injectable()
export class KnowledgeSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Действующие значения; при отсутствии строки — дефолты (без записи в БД). */
  async readTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<KnowledgeSettingsValues> {
    const row = await tx.knowledgeSettings.findUnique({
      where: { workspaceId },
      select: { verificationDays: true, revisionLimit: true }
    });
    return {
      verificationDays: row?.verificationDays ?? KNOWLEDGE_DEFAULT_VERIFICATION_DAYS,
      revisionLimit: row?.revisionLimit ?? KNOWLEDGE_DEFAULT_REVISION_LIMIT
    };
  }

  get(userId: string, workspaceId: string): Promise<KnowledgeSettings> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const values = await this.readTx(tx, workspaceId);
      return { workspaceId, ...values };
    });
  }

  update(userId: string, workspaceId: string, input: UpdateKnowledgeSettingsInput): Promise<KnowledgeSettings> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const row = await tx.knowledgeSettings.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          verificationDays: input.verificationDays ?? KNOWLEDGE_DEFAULT_VERIFICATION_DAYS,
          revisionLimit: input.revisionLimit ?? KNOWLEDGE_DEFAULT_REVISION_LIMIT
        },
        update: {
          verificationDays: input.verificationDays,
          revisionLimit: input.revisionLimit
        },
        select: { verificationDays: true, revisionLimit: true }
      });
      return { workspaceId, ...row };
    });
  }
}
