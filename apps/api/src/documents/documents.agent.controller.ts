import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AGENT_DOCUMENT_TEXT_MAX, agentSearchQuerySchema, type AgentDocumentText, type AgentSearchQuery, type DocumentItem } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DocumentsService } from "./documents.service";

/**
 * Инструменты ИИ-агента для модуля «Документы» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/documents")
export class DocumentsAgentController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  /** The list without the extracted text (it can be megabytes): the agent reads one document with `…/text`. */
  @Get()
  list(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentSearchQuerySchema)) query: AgentSearchQuery): Promise<Array<Omit<DocumentItem, "extractedText">>> {
    return this.tools.run(req, "orion_documents_list", async (agent) => {
      const items = await this.documents.list(agent.userId, agent.workspaceId);
      const needle = query.query?.toLowerCase();
      return items
        .filter((item) => !needle || item.name.toLowerCase().includes(needle))
        .map(({ extractedText: _text, ...item }) => item);
    });
  }

  @Get(":documentId/text")
  text(@Req() req: AgentRequest, @Param("documentId") documentId: string): Promise<AgentDocumentText> {
    return this.tools.run(
      req,
      "orion_documents_read_text",
      async (agent) => {
        const item = (await this.documents.list(agent.userId, agent.workspaceId)).find((doc) => doc.id === documentId);
        if (!item) throw new NotFoundException("Документ не найден");
        const text = item.extractedText ?? "";
        return { id: item.id, name: item.name, text: text.slice(0, AGENT_DOCUMENT_TEXT_MAX), truncated: text.length > AGENT_DOCUMENT_TEXT_MAX };
      },
      (doc) => ({ resource: `document:${doc.id}`, objectType: "document", objectId: doc.id, summary: `Прочитал документ «${doc.name}»` })
    );
  }
}
