import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createListInputSchema,
  createListItemInputSchema,
  updateListInputSchema,
  updateListItemInputSchema,
  type CreateListInput,
  type CreateListItemInput,
  type List,
  type ListItem,
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
    @Query("includeArchived") includeArchived?: string
  ): Promise<List[]> {
    return this.lists.list(user.userId, workspaceId, { includeArchived: includeArchived === "true" });
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

  @Post(":listId/items")
  createItem(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(createListItemInputSchema)) body: CreateListItemInput
  ): Promise<ListItem> {
    return this.lists.createItem(user.userId, workspaceId, listId, body);
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

  /** Deletes every checked item in the list at once — the "clear completed" action. */
  @Post(":listId/items/clear-checked")
  clearChecked(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string
  ): Promise<void> {
    return this.lists.clearChecked(user.userId, workspaceId, listId);
  }
}
