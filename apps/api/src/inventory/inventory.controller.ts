import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createInventoryItemInputSchema,
  createInventoryMovementInputSchema,
  updateInventoryItemInputSchema,
  type CreateInventoryItemInput,
  type CreateInventoryMovementInput,
  type InventoryItem,
  type InventoryMovement,
  type UpdateInventoryItemInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { InventoryService } from "./inventory.service";

@RequireModule("inventory")
@Controller("workspaces/:workspaceId/inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("items")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string
  ): Promise<InventoryItem[]> {
    return this.inventory.list(user.userId, workspaceId, includeArchived === "true");
  }

  @Post("items")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createInventoryItemInputSchema)) body: CreateInventoryItemInput
  ): Promise<InventoryItem> {
    return this.inventory.create(user.userId, workspaceId, body);
  }

  @Patch("items/:itemId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateInventoryItemInputSchema)) body: UpdateInventoryItemInput
  ): Promise<InventoryItem> {
    return this.inventory.update(user.userId, workspaceId, itemId, body);
  }

  /** Archiving, not deletion — the movement ledger stays (see InventoryService.archive). */
  @Delete("items/:itemId")
  archive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<InventoryItem> {
    return this.inventory.archive(user.userId, workspaceId, itemId);
  }

  @Get("items/:itemId/movements")
  listMovements(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<InventoryMovement[]> {
    return this.inventory.listMovements(user.userId, workspaceId, itemId);
  }

  @Post("items/:itemId/movements")
  recordMovement(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(createInventoryMovementInputSchema)) body: CreateInventoryMovementInput
  ): Promise<InventoryMovement> {
    return this.inventory.recordMovement(user.userId, workspaceId, itemId, body);
  }
}
