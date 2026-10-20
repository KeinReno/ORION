import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { agentListAddItemsInputSchema, parseListText, type AgentListAddItemsInput, type List, type ListItem } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ListsService } from "./lists.service";

/**
 * Инструменты ИИ-агента для модуля «Списки» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/lists")
export class ListsAgentController {
  constructor(
    private readonly lists: ListsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get()
  list(@Req() req: AgentRequest): Promise<List[]> {
    return this.tools.run(req, "orion_lists_list", (agent) => this.lists.list(agent.userId, agent.workspaceId));
  }

  /** Lines as a person types them («Молоко, 2 л», «# Группа») — the same parser as pasting into a list. */
  @Post(":listId/items")
  addItems(
    @Req() req: AgentRequest,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(agentListAddItemsInputSchema)) body: AgentListAddItemsInput
  ): Promise<ListItem[]> {
    return this.tools.run(
      req,
      "orion_lists_add_items",
      (agent) =>
        this.lists.createItemsBulk(agent.userId, agent.workspaceId, listId, {
          items: parseListText(body.text).map((entry) => ({
            label: entry.label,
            quantity: entry.quantity,
            unit: entry.unit ?? null,
            section: entry.section ?? null,
            checked: false
          }))
        }),
      (items) => ({ resource: `list:${listId}`, objectType: "list", objectId: listId, summary: `Добавил в список пунктов: ${items.length}` })
    );
  }
}
