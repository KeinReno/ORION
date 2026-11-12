import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  knowledgeSearchQuerySchema,
  type KnowledgeItemDetail,
  type KnowledgeSearchQuery,
  type KnowledgeSearchResult
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { KnowledgeSearchService } from "./knowledge-search.service";
import { KnowledgeService } from "./knowledge.service";

/**
 * Инструменты ИИ-агента для базы знаний (задание 06, п. 6.5): `orion_knowledge_search`
 * и `orion_knowledge_read` из каталога `AGENT_TOOLS`. Разрешение `knowledge.item.read`
 * обязательно (`AgentModuleToolsService` → `decideAgentModuleOperation`), режим токена,
 * включённость модуля и журнал чтений — там же. Ответ всегда несёт состояние проверки
 * (`verified` / `unverified` / `outdated`): агент видит, можно ли опираться на материал,
 * а не получает «тихо доверенный» текст.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/knowledge")
export class KnowledgeAgentController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly search: KnowledgeSearchService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get("search")
  searchItems(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(knowledgeSearchQuerySchema)) query: KnowledgeSearchQuery
  ): Promise<KnowledgeSearchResult[]> {
    return this.tools.run(
      req,
      "orion_knowledge_search",
      (agent) => this.search.search(agent.userId, agent.workspaceId, query),
      (results) => ({ summary: `Нашёл материалов: ${results.length} (запрос «${query.q}»)` })
    );
  }

  @Get("items/:itemId")
  readItem(@Req() req: AgentRequest, @Param("itemId") itemId: string): Promise<KnowledgeItemDetail> {
    return this.tools.run(
      req,
      "orion_knowledge_read",
      (agent) => this.knowledge.getItem(agent.userId, agent.workspaceId, itemId),
      (item) => ({
        resource: `knowledge:${item.id}`,
        objectType: "knowledge",
        objectId: item.id,
        summary: `Прочитал материал «${item.title}» (проверка: ${item.verificationState})`
      })
    );
  }
}
