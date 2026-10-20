import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  createInventoryItemInputSchema,
  createInventoryMovementInputSchema,
  type CreateInventoryItemInput,
  type CreateInventoryMovementInput,
  type InventoryItem,
  type InventoryMovement
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InventoryService } from "./inventory.service";

/**
 * Инструменты ИИ-агента для модуля «Склад» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/inventory")
export class InventoryAgentController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly tools: AgentModuleToolsService
  ) {}

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
