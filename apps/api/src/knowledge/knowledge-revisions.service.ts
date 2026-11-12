import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { KnowledgeItemDetail, KnowledgeRevision, KnowledgeVerificationState } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { toRevision } from "./knowledge-dto";
import { pruneKnowledgeRevisionsTx, revisionDiffers, snapshotKnowledgeRevisionTx } from "./knowledge-revisions";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeSettingsService } from "./knowledge-settings.service";

/**
 * История версий материала (задание 06, п. 6.3). Снимок делается по явному
 * «сохранить версию» (`create`) и при публикации материала; восстановление
 * применяет снимок как новую текущую версию и не перезаписывает историю —
 * прежние снимки остаются, новый помечается `restoredFromId`.
 */
@Injectable()
export class KnowledgeRevisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly settings: KnowledgeSettingsService,
    private readonly events: DomainEventBus,
    private readonly knowledge: KnowledgeService
  ) {}

  async list(userId: string, workspaceId: string, itemId: string): Promise<KnowledgeRevision[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertItemTx(tx, workspaceId, itemId);
      const rows = await tx.knowledgeItemRevision.findMany({
        where: { workspaceId, itemId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      return rows.map(toRevision);
    });
  }

  /** Явное сохранение версии: снимок текущего содержимого (номер ревизии не меняется). */
  async create(userId: string, workspaceId: string, itemId: string): Promise<KnowledgeRevision> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const item = await this.assertItemTx(tx, workspaceId, itemId);
      const settings = await this.settings.readTx(tx, workspaceId);
      const row = await snapshotKnowledgeRevisionTx(tx, item, userId);
      await pruneKnowledgeRevisionsTx(tx, itemId, settings.revisionLimit);
      return toRevision(row);
    });
  }

  /** Восстановление: снимок становится текущим текстом, история не перезаписывается. */
  async restore(userId: string, workspaceId: string, itemId: string, revisionId: string): Promise<KnowledgeItemDetail> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const item = await this.assertItemTx(tx, workspaceId, itemId);
      const revision = await tx.knowledgeItemRevision.findFirst({ where: { id: revisionId, itemId, workspaceId } });
      if (!revision) throw new NotFoundException("Версия материала не найдена");
      const settings = await this.settings.readTx(tx, workspaceId);
      const fromState = item.verificationState as KnowledgeVerificationState;
      const changed = revisionDiffers(revision, item);
      const written = await tx.knowledgeItem.update({
        where: { id: itemId },
        data: {
          title: revision.title,
          summary: revision.summary,
          body: revision.body,
          origin: revision.origin === null ? Prisma.DbNull : (revision.origin as Prisma.InputJsonValue),
          revision: { increment: 1 },
          ...(changed && fromState !== "unverified" ? { verificationState: "unverified" } : {})
        }
      });
      await snapshotKnowledgeRevisionTx(tx, written, userId, revisionId);
      await pruneKnowledgeRevisionsTx(tx, itemId, settings.revisionLimit);
      if (changed && fromState !== "unverified") {
        await this.events.publishTx(tx, {
          workspaceId,
          type: "knowledge.item.verification.changed",
          payload: { id: itemId, from: fromState, to: "unverified" },
          actorId: userId
        });
      }
    });
    return this.knowledge.getItem(userId, workspaceId, itemId);
  }

  private async assertItemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    const item = await tx.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
    if (!item) throw new NotFoundException("Материал не найден");
    return item;
  }
}
