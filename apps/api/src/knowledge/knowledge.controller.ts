import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createKnowledgeCategoryInputSchema,
  createKnowledgeItemInputSchema,
  createKnowledgeRelationInputSchema,
  createKnowledgeSourceInputSchema,
  updateKnowledgeCategoryInputSchema,
  updateKnowledgeItemInputSchema,
  type CreateKnowledgeCategoryInput,
  type CreateKnowledgeItemInput,
  type CreateKnowledgeRelationInput,
  type CreateKnowledgeSourceInput,
  type KnowledgeCategory,
  type KnowledgeItem,
  type KnowledgeItemDetail,
  type KnowledgeRelation,
  type KnowledgeSource,
  type UpdateKnowledgeCategoryInput,
  type UpdateKnowledgeItemInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { KnowledgeService } from "./knowledge.service";

@RequireModule("knowledge")
@Controller("workspaces/:workspaceId/knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

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
    @Query("includeArchived") includeArchived?: string
  ): Promise<KnowledgeItem[]> {
    return this.knowledge.listItems(user.userId, workspaceId, includeArchived === "true");
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
