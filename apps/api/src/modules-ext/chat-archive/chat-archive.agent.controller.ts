import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  chatArchiveImportBodySchema,
  chatArchiveLinesQuerySchema,
  chatArchiveSearchQuerySchema,
  chatArchiveSourceSchema,
  type ChatArchiveConversation,
  type ChatArchiveImportBody,
  type ChatArchiveImportResult,
  type ChatArchiveLinesPage,
  type ChatArchiveSearchHit,
  type ChatArchiveSearchQuery
} from "@orion/shared-types";
import { z } from "zod";
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ChatArchiveService } from "./chat-archive.service";

/** Агенту по умолчанию нужны реплики, а не вызовы инструментов; страница меньше, чем у панели. */
const agentReadQuerySchema = chatArchiveLinesQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(300).default(100),
  messagesOnly: z.enum(["true", "false"]).default("true").transform((value) => value === "true")
});

/**
 * Инструменты ИИ-агента для архива чатов (G13): поиск по прошлым разговорам, список, чтение одного и разовый импорт.
 * Описаны в `module.manifest.json` → `agent.tools`; разрешение, режим, включённость модуля, лимит записи и журнал — в
 * `AgentModuleToolsService`. Архив пишется и читается от имени владельца токена — тот же личный архив, что в панели.
 * Импорт хуком (после каждого ответа, без журнала) — отдельно, `ChatArchiveHookController`.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/chat-archive")
export class ChatArchiveAgentController {
  constructor(
    private readonly service: ChatArchiveService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get("conversations")
  list(
    @Req() req: AgentRequest,
    @Query("source", new ZodValidationPipe(chatArchiveSourceSchema.optional())) source?: ChatArchiveConversation["source"]
  ): Promise<ChatArchiveConversation[]> {
    return this.tools.run(req, "orion_chat_archive_list", async (agent) => (await this.service.list(agent.userId, agent.workspaceId, source)).slice(0, 50));
  }

  @Get("search")
  search(@Req() req: AgentRequest, @Query(new ZodValidationPipe(chatArchiveSearchQuerySchema)) query: ChatArchiveSearchQuery): Promise<ChatArchiveSearchHit[]> {
    return this.tools.run(req, "orion_chat_archive_search", (agent) => this.service.search(agent.userId, agent.workspaceId, query));
  }

  @Get("conversations/:conversationId/lines")
  read(
    @Req() req: AgentRequest,
    @Param("conversationId") conversationId: string,
    @Query(new ZodValidationPipe(agentReadQuerySchema)) query: z.infer<typeof agentReadQuerySchema>
  ): Promise<ChatArchiveLinesPage> {
    return this.tools.run(
      req,
      "orion_chat_archive_read",
      (agent) => this.service.lines(agent.userId, agent.workspaceId, conversationId, query),
      () => ({ resource: `chat-archive:${conversationId}` })
    );
  }

  /** Пачка строк JSON-телом, как любая запись агента (лимит в час, журнал). */
  @Post("import")
  import(@Req() req: AgentRequest, @Body(new ZodValidationPipe(chatArchiveImportBodySchema)) body: ChatArchiveImportBody): Promise<ChatArchiveImportResult> {
    const { lines, ...query } = body;
    return this.tools.run(
      req,
      "orion_chat_archive_import",
      (agent) => this.service.importLines(agent.userId, agent.workspaceId, query, lines),
      (result) => ({ resource: `chat-archive:${result.conversation.id}`, summary: `Сохранил в архив «${result.conversation.title}»: +${result.appended} строк` })
    );
  }
}
