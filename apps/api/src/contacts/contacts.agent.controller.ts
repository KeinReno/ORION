import { Body, Controller, Delete, Get, OnModuleInit, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  agentSearchQuerySchema,
  createContactCardInputSchema,
  createContactInteractionInputSchema,
  updateContactCardInputSchema,
  type AgentDeleteRequest,
  type AgentSearchQuery,
  type ContactCard,
  type ContactInteraction,
  type CreateContactCardInput,
  type CreateContactInteractionInput
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ContactsService } from "./contacts.service";

const contactChangeSchema = updateContactCardInputSchema.pick({
  name: true,
  phone: true,
  email: true,
  organization: true,
  role: true,
  address: true,
  birthday: true
});

/** An interaction is addressed as `<contactId>:<interactionId>` in requests: the service needs both. */
const splitKey = (key: string): [string, string] => {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
};

const CONTACT_LABELS = { name: "Имя", phone: "Телефон", email: "Почта", organization: "Организация", role: "Должность", address: "Адрес", birthday: "День рождения" };

/**
 * Инструменты ИИ-агента для модуля «Контакты» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/contacts")
export class ContactsAgentController implements OnModuleInit {
  constructor(
    private readonly contacts: ContactsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, contactId: string) => {
      const card = await this.contacts.get(userId, workspaceId, contactId).catch(() => null);
      if (!card) return null;
      const fields = Object.fromEntries(Object.keys(CONTACT_LABELS).map((key) => [key, (card as unknown as Record<string, unknown>)[key]]));
      return { title: card.name, fields, labels: CONTACT_LABELS };
    };
    this.tools.register("orion_contacts_update", {
      noun: "контакт",
      describe,
      apply: (userId, workspaceId, contactId, args) => this.contacts.update(userId, workspaceId, contactId, contactChangeSchema.parse(args))
    });
    this.tools.register("orion_contacts_delete", { noun: "контакт", describe, apply: (userId, workspaceId, contactId) => this.contacts.remove(userId, workspaceId, contactId) });
    this.tools.register("orion_contacts_delete_interaction", {
      noun: "запись общения",
      describe: async (userId, workspaceId, key) => {
        const [contactId, interactionId] = splitKey(key);
        const card = await this.contacts.get(userId, workspaceId, contactId).catch(() => null);
        const item = card ? (await this.contacts.listInteractions(userId, workspaceId, contactId)).find((entry) => entry.id === interactionId) : undefined;
        if (!card || !item) return null;
        return {
          title: `${card.name}: ${item.note || item.kind}`,
          fields: { kind: item.kind, occurredAt: item.occurredAt, note: item.note },
          labels: { kind: "Вид", occurredAt: "Когда", note: "Заметка" }
        };
      },
      apply: (userId, workspaceId, key) => {
        const [contactId, interactionId] = splitKey(key);
        return this.contacts.removeInteraction(userId, workspaceId, contactId, interactionId);
      }
    });
  }

  @Get()
  list(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentSearchQuerySchema)) query: AgentSearchQuery): Promise<ContactCard[]> {
    return this.tools.run(req, "orion_contacts_list", async (agent) => {
      const cards = await this.contacts.list(agent.userId, agent.workspaceId);
      const needle = query.query?.toLowerCase();
      return needle ? cards.filter((card) => JSON.stringify(card).toLowerCase().includes(needle)) : cards;
    });
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createContactCardInputSchema)) body: CreateContactCardInput): Promise<ContactCard> {
    return this.tools.run(
      req,
      "orion_contacts_create",
      (agent) => this.contacts.create(agent.userId, agent.workspaceId, body),
      (card) => ({ resource: `contact:${card.id}`, objectType: "contact", objectId: card.id, summary: `Создал контакт «${card.name}»` })
    );
  }

  @Patch(":contactId")
  update(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(contactChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_contacts_update", contactId, body);
  }

  @Post(":contactId/interactions")
  logInteraction(
    @Req() req: AgentRequest,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(createContactInteractionInputSchema)) body: CreateContactInteractionInput
  ): Promise<ContactInteraction> {
    return this.tools.run(
      req,
      "orion_contacts_log_interaction",
      (agent) => this.contacts.createInteraction(agent.userId, agent.workspaceId, contactId, body),
      () => ({ resource: `contact:${contactId}`, objectType: "contact", objectId: contactId, summary: "Записал общение с контактом" })
    );
  }

  @Delete(":contactId")
  remove(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_contacts_delete", contactId, {}, { reason: body.reason });
  }

  @Delete(":contactId/interactions/:interactionId")
  removeInteraction(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("contactId") contactId: string,
    @Param("interactionId") interactionId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_contacts_delete_interaction", `${contactId}:${interactionId}`, {}, { reason: body.reason });
  }
}
