import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { agentSearchQuerySchema, type AgentSearchQuery, type ContactCard } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ContactsService } from "./contacts.service";

/**
 * Инструменты ИИ-агента для модуля «Контакты» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/contacts")
export class ContactsAgentController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get()
  list(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentSearchQuerySchema)) query: AgentSearchQuery): Promise<ContactCard[]> {
    return this.tools.run(req, "orion_contacts_list", async (agent) => {
      const cards = await this.contacts.list(agent.userId, agent.workspaceId);
      const needle = query.query?.toLowerCase();
      return needle ? cards.filter((card) => JSON.stringify(card).toLowerCase().includes(needle)) : cards;
    });
  }
}
