import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { InventoryItem } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
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
}
