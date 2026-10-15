import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createListInputSchema,
  createListItemInputSchema,
  createListItemsBulkInputSchema,
  duplicateListInputSchema,
  reorderInputSchema,
  restoreListItemsInputSchema,
  updateListInputSchema,
  updateListItemInputSchema,
  type ClearCheckedResult,
  type CreateListInput,
  type CreateListItemInput,
  type CreateListItemsBulkInput,
  type DuplicateListInput,
  type List,
  type ListItem,
  type ReorderInput,
  type RestoreListItemsInput,
  type UpdateListInput,
  type UpdateListItemInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { ListsService } from "./lists.service";

@RequireModule("lists")
@Controller("workspaces/:workspaceId/lists")
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("templates") templates?: string
  ): Promise<List[]> {
    return this.lists.list(user.userId, workspaceId, { includeArchived: includeArchived === "true", templates: templates === "true" });
  }

  /** Manual order of the lists. Declared before the `:listId` routes so "order" is never read as an id. */
  @Put("order")
  reorder(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(reorderInputSchema)) body: ReorderInput
  ): Promise<void> {
    return this.lists.reorder(user.userId, workspaceId, body);
  }

  @Get(":listId")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<List> {
    return this.lists.get(user.userId, workspaceId, listId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createListInputSchema)) body: CreateListInput
  ): Promise<List> {
    return this.lists.create(user.userId, workspaceId, body);
  }

  @Patch(":listId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(updateListInputSchema)) body: UpdateListInput
  ): Promise<List> {
    return this.lists.update(user.userId, workspaceId, listId, body);
  }

  /** Archiving, not deletion — the items stay (see ListsService.archive). */
  @Delete(":listId")
  archive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<List> {
    return this.lists.archive(user.userId, workspaceId, listId);
  }

  /** Real deletion, allowed only for an archived list or a template (see ListsService.deletePermanently). */
  @Delete(":listId/permanent")
  deletePermanently(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<void> {
    return this.lists.deletePermanently(user.userId, workspaceId, listId);
  }

  @Post(":listId/duplicate")
  duplicate(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(duplicateListInputSchema)) body: DuplicateListInput
  ): Promise<List> {
    return this.lists.duplicate(user.userId, workspaceId, listId, body);
  }

  /** «Новый круг»: untick everything (see ListsService.reset). */
  @Post(":listId/reset")
  reset(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<List> {
    return this.lists.reset(user.userId, workspaceId, listId);
  }

  @Post(":listId/items")
  createItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(createListItemInputSchema)) body: CreateListItemInput
  ): Promise<ListItem> {
    return this.lists.createItem(user.userId, workspaceId, listId, body);
  }

  @Post(":listId/items/bulk")
  createItemsBulk(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(createListItemsBulkInputSchema)) body: CreateListItemsBulkInput
  ): Promise<ListItem[]> {
    return this.lists.createItemsBulk(user.userId, workspaceId, listId, body);
  }

  @Put(":listId/items/order")
  reorderItems(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(reorderInputSchema)) body: ReorderInput
  ): Promise<List> {
    return this.lists.reorderItems(user.userId, workspaceId, listId, body);
  }

  /** Puts deleted entries back whole (the «Отменить» of «Очистить отмеченные»). */
  @Post(":listId/items/restore")
  restoreItems(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(restoreListItemsInputSchema)) body: RestoreListItemsInput
  ): Promise<List> {
    return this.lists.restoreItems(user.userId, workspaceId, listId, body);
  }

  @Patch(":listId/items/:itemId")
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateListItemInputSchema)) body: UpdateListItemInput
  ): Promise<ListItem> {
    return this.lists.updateItem(user.userId, workspaceId, listId, itemId, body);
  }

  /** Items are deleted for real — unlike the list itself, there's nothing in them worth archiving. */
  @Delete(":listId/items/:itemId")
  deleteItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string
  ): Promise<void> {
    return this.lists.deleteItem(user.userId, workspaceId, listId, itemId);
  }

  /** Deletes every checked item in the list at once — the "clear completed" action; returns what it removed. */
  @Post(":listId/items/clear-checked")
  clearChecked(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<ClearCheckedResult> {
    return this.lists.clearChecked(user.userId, workspaceId, listId);
  }
}
