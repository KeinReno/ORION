import { Body, Controller, Delete, Get, OnModuleInit, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  agentListAddItemsInputSchema,
  createListInputSchema,
  parseListText,
  updateListItemInputSchema,
  type AgentDeleteRequest,
  type AgentListAddItemsInput,
  type CreateListInput,
  type List,
  type ListItem
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ListsService } from "./lists.service";

const itemChangeSchema = updateListItemInputSchema.pick({ label: true, checked: true, quantity: true, unit: true, note: true });

/** A list item is addressed as `<listId>:<itemId>` in requests: the service needs both. */
const itemKey = (listId: string, itemId: string): string => `${listId}:${itemId}`;
const splitKey = (key: string): [string, string] => {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
};

/**
 * Инструменты ИИ-агента для модуля «Списки» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/lists")
export class ListsAgentController implements OnModuleInit {
  constructor(
    private readonly lists: ListsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, key: string) => {
      const [listId, itemId] = splitKey(key);
      const list = await this.lists.get(userId, workspaceId, listId).catch(() => null);
      const item = list?.items.find((entry) => entry.id === itemId);
      if (!list || !item) return null;
      return {
        title: `${item.label} (${list.name})`,
        fields: { label: item.label, checked: item.checked, quantity: item.quantity, unit: item.unit, note: item.note },
        labels: { label: "Текст", checked: "Отмечен", quantity: "Количество", unit: "Единица", note: "Заметка" }
      };
    };
    this.tools.register("orion_lists_archive", {
      noun: "список",
      describe: async (userId, workspaceId, listId) => {
        const list = await this.lists.get(userId, workspaceId, listId).catch(() => null);
        return list ? { title: list.name, fields: { name: list.name, items: list.items.length }, labels: { name: "Название", items: "Пунктов" } } : null;
      },
      apply: (userId, workspaceId, listId) => this.lists.archive(userId, workspaceId, listId)
    });
    this.tools.register("orion_lists_update_item", {
      noun: "пункт списка",
      describe,
      apply: (userId, workspaceId, key, args) => {
        const [listId, itemId] = splitKey(key);
        return this.lists.updateItem(userId, workspaceId, listId, itemId, itemChangeSchema.parse(args));
      }
    });
    this.tools.register("orion_lists_delete_item", {
      noun: "пункт списка",
      describe,
      apply: (userId, workspaceId, key) => {
        const [listId, itemId] = splitKey(key);
        return this.lists.deleteItem(userId, workspaceId, listId, itemId);
      }
    });
  }

  @Get()
  list(@Req() req: AgentRequest): Promise<List[]> {
    return this.tools.run(req, "orion_lists_list", (agent) => this.lists.list(agent.userId, agent.workspaceId));
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createListInputSchema)) body: CreateListInput): Promise<List> {
    return this.tools.run(
      req,
      "orion_lists_create",
      (agent) => this.lists.create(agent.userId, agent.workspaceId, body),
      (list) => ({ resource: `list:${list.id}`, objectType: "list", objectId: list.id, summary: `Создал список «${list.name}»` })
    );
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

  @Patch(":listId/items/:itemId")
  updateItem(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(itemChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_lists_update_item", itemKey(listId, itemId), body);
  }

  @Delete(":listId/items/:itemId")
  deleteItem(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("listId") listId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_lists_delete_item", itemKey(listId, itemId), {}, { reason: body.reason });
  }

  /** Archive, as the panel does: a list is erased for good only from the archive, by a human. */
  @Delete(":listId")
  archive(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("listId") listId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_lists_archive", listId, {}, { reason: body.reason });
  }
}
