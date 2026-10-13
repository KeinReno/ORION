import { Body, Controller, Param, Post, Put } from "@nestjs/common";
import {
  addInventoryToListInputSchema,
  linkListItemInventoryInputSchema,
  type AddInventoryToListInput,
  type LinkListItemInventoryInput,
  type ListItem,
  type PurchaseListItemResult
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { ListsInventoryService } from "./lists-inventory.service";

/** Server side of the «Покупки → Склад» plugin: 409 with Lists or the plugin off; the service also requires Inventory. */
@RequireModule("lists")
@RequirePlugin("lists-inventory")
@Controller("workspaces/:workspaceId/lists-inventory")
export class ListsInventoryController {
  constructor(private readonly bridge: ListsInventoryService) {}

  @Put("lists/:listId/items/:itemId/link")
  link(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(linkListItemInventoryInputSchema)) body: LinkListItemInventoryInput
  ): Promise<ListItem> {
    return this.bridge.link(user.userId, workspaceId, listId, itemId, body);
  }

  @Post("lists/:listId/items/:itemId/purchase")
  purchase(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string
  ): Promise<PurchaseListItemResult> {
    return this.bridge.purchase(user.userId, workspaceId, listId, itemId);
  }

  @Post("inventory/:inventoryItemId/to-list")
  addToList(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("inventoryItemId") inventoryItemId: string,
    @Body(new ZodValidationPipe(addInventoryToListInputSchema)) body: AddInventoryToListInput
  ): Promise<ListItem> {
    return this.bridge.addToList(user.userId, workspaceId, inventoryItemId, body);
  }
}
