import { Body, Controller, Delete, Get, OnModuleInit, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  createInventoryItemInputSchema,
  createInventoryMovementInputSchema,
  type AgentDeleteRequest,
  type CreateInventoryItemInput,
  type CreateInventoryMovementInput,
  type InventoryItem,
  type InventoryMovement
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InventoryService } from "./inventory.service";

/**
 * Инструменты ИИ-агента для модуля «Склад» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/inventory")
export class InventoryAgentController implements OnModuleInit {
  constructor(
    private readonly inventory: InventoryService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    this.tools.register("orion_inventory_archive_item", {
      noun: "позиция склада",
      describe: async (userId, workspaceId, itemId) => {
        const item = (await this.inventory.list(userId, workspaceId)).find((entry) => entry.id === itemId);
        return item
          ? { title: item.name, fields: { name: item.name, balance: item.balance, unit: item.unit }, labels: { name: "Название", balance: "Остаток", unit: "Единица" } }
          : null;
      },
      apply: (userId, workspaceId, itemId) => this.inventory.archive(userId, workspaceId, itemId)
    });
  }

  @Get()
  list(@Req() req: AgentRequest): Promise<InventoryItem[]> {
    return this.tools.run(req, "orion_inventory_list", (agent) => this.inventory.list(agent.userId, agent.workspaceId));
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createInventoryItemInputSchema)) body: CreateInventoryItemInput): Promise<InventoryItem> {
    return this.tools.run(
      req,
      "orion_inventory_create_item",
      (agent) => this.inventory.create(agent.userId, agent.workspaceId, body),
      (item) => ({ resource: `inventory:${item.id}`, objectType: "inventory", objectId: item.id, summary: `Завёл на складе «${item.name}»` })
    );
  }

  /** Archive, not erase: the movements history stays, the item leaves the active list. */
  @Delete(":itemId")
  archive(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_inventory_archive_item", itemId, {}, { reason: body.reason });
  }

  @Post(":itemId/movements")
  move(
    @Req() req: AgentRequest,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(createInventoryMovementInputSchema)) body: CreateInventoryMovementInput
  ): Promise<InventoryMovement> {
    return this.tools.run(
      req,
      "orion_inventory_move",
      (agent) => this.inventory.recordMovement(agent.userId, agent.workspaceId, itemId, body),
      () => ({ resource: `inventory:${itemId}`, objectType: "inventory", objectId: itemId, summary: `Склад: ${body.type === "receipt" ? "приход" : body.type === "issue" ? "расход" : "корректировка"} ${body.quantity}` })
    );
  }
}
