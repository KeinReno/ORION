import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createKnowledgeCategoryInputSchema,
  createKnowledgeItemInputSchema,
  createKnowledgeRelationInputSchema,
  createKnowledgeSourceInputSchema,
  knowledgeFromInboxInputSchema,
  knowledgeImportDocumentsInputSchema,
  knowledgeListQuerySchema,
  knowledgeSearchQuerySchema,
  updateKnowledgeCategoryInputSchema,
  updateKnowledgeItemInputSchema,
  updateKnowledgeSettingsInputSchema,
  type CreateKnowledgeCategoryInput,
  type CreateKnowledgeItemInput,
  type CreateKnowledgeRelationInput,
  type CreateKnowledgeSourceInput,
  type KnowledgeCategory,
  type KnowledgeFromInboxInput,
  type KnowledgeFromInboxResult,
  type KnowledgeImportDocumentsInput,
  type KnowledgeImportReport,
  type KnowledgeItem,
  type KnowledgeItemDetail,
  type KnowledgeListQuery,
  type KnowledgeRelation,
  type KnowledgeRevision,
  type KnowledgeSearchQuery,
  type KnowledgeSearchResult,
  type KnowledgeSettings,
  type KnowledgeSource,
  type UpdateKnowledgeCategoryInput,
  type UpdateKnowledgeItemInput,
  type UpdateKnowledgeSettingsInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { KnowledgeImportService } from "./knowledge-import.service";
import { KnowledgeRevisionsService } from "./knowledge-revisions.service";
import { KnowledgeSearchService } from "./knowledge-search.service";
import { KnowledgeSettingsService } from "./knowledge-settings.service";
import { KnowledgeService } from "./knowledge.service";

@RequireModule("knowledge")
@Controller("workspaces/:workspaceId/knowledge")
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly settings: KnowledgeSettingsService,
    private readonly search: KnowledgeSearchService,
    private readonly revisions: KnowledgeRevisionsService,
    private readonly importService: KnowledgeImportService
  ) {}

  @Get("settings")
  getSettings(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<KnowledgeSettings> {
    return this.settings.get(user.userId, workspaceId);
  }

  @Patch("settings")
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(updateKnowledgeSettingsInputSchema)) input: UpdateKnowledgeSettingsInput
  ): Promise<KnowledgeSettings> {
    return this.settings.update(user.userId, workspaceId, input);
  }

  /** Полнотекстовый поиск (п. 6.2). Отдельный endpoint, пока глобальный провайдер не формализован заданием 10. */
  @Get("search")
  searchItems(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(knowledgeSearchQuerySchema)) query: KnowledgeSearchQuery
  ): Promise<KnowledgeSearchResult[]> {
    return this.search.search(user.userId, workspaceId, query);
  }

  /** Массовый импорт уже загруженных файлов; пофайловый отчёт (п. 6.4). */
  @Post("import/documents")
  importDocuments(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(knowledgeImportDocumentsInputSchema)) input: KnowledgeImportDocumentsInput
  ): Promise<KnowledgeImportReport> {
    return this.importService.importDocuments(user.userId, workspaceId, input);
  }

  /** «Сохранить входящее в базу знаний» (п. 6.4); запись из входящих удаляется только по `deleteFromInbox`. */
  @Post("from-inbox/:inboxItemId")
  fromInbox(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("inboxItemId") inboxItemId: string,
    @Body(new ZodValidationPipe(knowledgeFromInboxInputSchema)) input: KnowledgeFromInboxInput
  ): Promise<KnowledgeFromInboxResult> {
    return this.importService.fromInbox(user.userId, workspaceId, inboxItemId, input);
  }

  @Get("categories")
  listCategories(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<KnowledgeCategory[]> {
    return this.knowledge.listCategories(user.userId, workspaceId);
  }

  @Post("categories")
  createCategory(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createKnowledgeCategoryInputSchema)) input: CreateKnowledgeCategoryInput
  ): Promise<KnowledgeCategory> {
    return this.knowledge.createCategory(user.userId, workspaceId, input);
  }

  @Patch("categories/:categoryId")
  updateCategory(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("categoryId") categoryId: string,
    @Body(new ZodValidationPipe(updateKnowledgeCategoryInputSchema)) input: UpdateKnowledgeCategoryInput
  ): Promise<KnowledgeCategory> {
    return this.knowledge.updateCategory(user.userId, workspaceId, categoryId, input);
  }

  @Delete("categories/:categoryId")
  deleteCategory(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("categoryId") categoryId: string
  ): Promise<void> {
    return this.knowledge.deleteCategory(user.userId, workspaceId, categoryId);
  }

  @Get("items")
  listItems(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(knowledgeListQuerySchema)) query: KnowledgeListQuery
  ): Promise<KnowledgeItem[]> {
    return this.knowledge.listItems(user.userId, workspaceId, query);
  }

  @Post("items")
  createItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createKnowledgeItemInputSchema)) input: CreateKnowledgeItemInput
  ): Promise<KnowledgeItemDetail> {
    return this.knowledge.createItem(user.userId, workspaceId, input);
  }

  @Get("items/:itemId")
  getItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<KnowledgeItemDetail> {
    return this.knowledge.getItem(user.userId, workspaceId, itemId);
  }

  @Patch("items/:itemId")
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateKnowledgeItemInputSchema)) input: UpdateKnowledgeItemInput
  ): Promise<KnowledgeItemDetail> {
    return this.knowledge.updateItem(user.userId, workspaceId, itemId, input);
  }

  @Delete("items/:itemId")
  deleteItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<void> {
    return this.knowledge.deleteItem(user.userId, workspaceId, itemId);
  }

  /** Подтверждение проверки материала (п. 6.1). */
  @Post("items/:itemId/verify")
  verifyItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<KnowledgeItemDetail> {
    return this.knowledge.verifyItem(user.userId, workspaceId, itemId);
  }

  @Get("items/:itemId/revisions")
  listRevisions(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<KnowledgeRevision[]> {
    return this.revisions.list(user.userId, workspaceId, itemId);
  }

  /** Явное «сохранить версию» (п. 6.3). */
  @Post("items/:itemId/revisions")
  createRevision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<KnowledgeRevision> {
    return this.revisions.create(user.userId, workspaceId, itemId);
  }

  @Post("items/:itemId/revisions/:revisionId/restore")
  restoreRevision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Param("revisionId") revisionId: string
  ): Promise<KnowledgeItemDetail> {
    return this.revisions.restore(user.userId, workspaceId, itemId, revisionId);
  }

  @Post("items/:itemId/sources")
  addSource(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(createKnowledgeSourceInputSchema)) input: CreateKnowledgeSourceInput
  ): Promise<KnowledgeSource> {
    return this.knowledge.addSource(user.userId, workspaceId, itemId, input);
  }

  @Delete("sources/:sourceId")
  deleteSource(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("sourceId") sourceId: string
  ): Promise<void> {
    return this.knowledge.deleteSource(user.userId, workspaceId, sourceId);
  }

  @Post("items/:itemId/relations")
  addRelation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(createKnowledgeRelationInputSchema)) input: CreateKnowledgeRelationInput
  ): Promise<KnowledgeRelation> {
    return this.knowledge.addRelation(user.userId, workspaceId, itemId, input);
  }

  @Delete("relations/:relationId")
  deleteRelation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("relationId") relationId: string
  ): Promise<void> {
    return this.knowledge.deleteRelation(user.userId, workspaceId, relationId);
  }
}
