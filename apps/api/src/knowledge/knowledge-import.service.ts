import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  KnowledgeFromInboxInput,
  KnowledgeFromInboxResult,
  KnowledgeImportDocumentsInput,
  KnowledgeImportReport,
  KnowledgeImportReportItem
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { readKnowledgeSourceTitle as readDocumentTitle } from "../documents/public";
import { InboxItems } from "../inbox/public/inbox-items";
import { ProjectReferences } from "../projects/public/project-references";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { toDetail } from "./knowledge-dto";
import { knowledgeTitleFromFile, originFromFile, originFromInbox } from "./knowledge-import";
import { assertKnowledgeCategoryTx, assertKnowledgeProjectTx } from "./knowledge-refs";
import { KnowledgeSettingsService } from "./knowledge-settings.service";

/**
 * Входящие и импорт (задание 06, п. 6.4).
 *
 * Массовый импорт принимает уже загруженные файлы Documents и создаёт по одному
 * самостоятельному материалу на файл. Атомарность — пофайловая: каждый файл
 * пишется своей транзакцией, ошибка одного попадает в отчёт и не откатывает
 * остальные (требование «без остановки на первой ошибке»).
 *
 * Маршрутизация записи «Входящих» читает и (по отдельному подтверждению) удаляет
 * запись через публичный контракт inbox — в той же транзакции, что создаёт материал.
 */
@Injectable()
export class KnowledgeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projectReferences: ProjectReferences,
    private readonly settings: KnowledgeSettingsService,
    private readonly inbox: InboxItems
  ) {}

  async importDocuments(
    userId: string,
    workspaceId: string,
    input: KnowledgeImportDocumentsInput
  ): Promise<KnowledgeImportReport> {
    // Общие ссылки проверяем один раз: они одинаковы для всех файлов.
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertKnowledgeCategoryTx(tx, workspaceId, input.categoryId);
      await assertKnowledgeProjectTx(tx, this.projectReferences, workspaceId, input.projectId);
    });

    const results: KnowledgeImportReportItem[] = [];
    for (const documentId of input.documentIds) {
      try {
        const itemId = await this.importDocument(userId, workspaceId, documentId, input);
        results.push({ documentId, ok: true, itemId, error: null });
      } catch (error) {
        results.push({ documentId, ok: false, itemId: null, error: (error as Error).message });
      }
    }
    const okCount = results.filter((row) => row.ok).length;
    return { okCount, failedCount: results.length - okCount, results };
  }

  private importDocument(
    userId: string,
    workspaceId: string,
    documentId: string,
    input: KnowledgeImportDocumentsInput
  ): Promise<string> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const fileName = await readDocumentTitle(tx, workspaceId, documentId);
      if (fileName === null) throw new BadRequestException("Документ не найден в этом пространстве");
      const now = new Date();
      const item = await tx.knowledgeItem.create({
        data: {
          workspaceId,
          title: knowledgeTitleFromFile(fileName),
          categoryId: input.categoryId ?? null,
          projectId: input.projectId ?? null,
          status: input.status ?? "approved",
          kind: input.kind ?? "fact",
          createdBy: userId,
          origin: originFromFile(fileName, userId, now) as Prisma.InputJsonValue
        },
        select: { id: true }
      });
      await tx.knowledgeSource.create({
        data: { workspaceId, itemId: item.id, type: "document", sourceTitle: fileName, documentId }
      });
      return item.id;
    });
  }

  async fromInbox(
    userId: string,
    workspaceId: string,
    inboxItemId: string,
    input: KnowledgeFromInboxInput
  ): Promise<KnowledgeFromInboxResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const inbox = await this.inbox.readTx(tx, workspaceId, inboxItemId);
      if (!inbox) throw new NotFoundException("Запись входящих не найдена");
      await assertKnowledgeCategoryTx(tx, workspaceId, input.categoryId);
      await assertKnowledgeProjectTx(tx, this.projectReferences, workspaceId, input.projectId);
      const settings = await this.settings.readTx(tx, workspaceId);
      const now = new Date();
      const row = await tx.knowledgeItem.create({
        data: {
          workspaceId,
          title: input.title ?? inbox.title,
          summary: "",
          body: inbox.body,
          categoryId: input.categoryId ?? null,
          projectId: input.projectId ?? inbox.projectId,
          status: "captured",
          kind: input.kind ?? "fact",
          createdBy: userId,
          origin: originFromInbox(inbox, userId, now) as Prisma.InputJsonValue
        },
        include: {
          sources: true,
          fromRelations: { include: { to: { select: { id: true, title: true } } } },
          toRelations: { include: { from: { select: { id: true, title: true } } } }
        }
      });
      const removedFromInbox = input.deleteFromInbox ? await this.inbox.removeTx(tx, workspaceId, inboxItemId) : false;
      return { item: toDetail(row, settings, now), removedFromInbox };
    });
  }
}
