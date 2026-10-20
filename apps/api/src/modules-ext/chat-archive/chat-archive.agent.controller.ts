import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import {
  chatArchiveImportBodySchema,
  chatArchiveImportQuerySchema,
  chatArchiveImportStateQuerySchema,
  chatArchiveLinesQuerySchema,
  chatArchiveSearchQuerySchema,
  chatArchiveSourceSchema,
  decideAgentModuleOperation,
  type ChatArchiveConversation,
  type ChatArchiveImportBody,
  type ChatArchiveImportQuery,
  type ChatArchiveImportResult,
  type ChatArchiveImportState,
  type ChatArchiveImportStateQuery,
  type ChatArchiveLinesPage,
  type ChatArchiveSearchHit,
  type ChatArchiveSearchQuery
} from "@orion/shared-types";
import { z } from "zod";
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import type { AgentContext } from "../../ai/agent-tokens.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ModulesService } from "../../modules/modules.service";
import { linesFromUpload, linesInterceptor, type UploadedLinesFile } from "./chat-archive.controller";
import { ChatArchiveService } from "./chat-archive.service";

/** Агенту по умолчанию нужны реплики, а не вызовы инструментов; страница меньше, чем у панели. */
const agentReadQuerySchema = chatArchiveLinesQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(300).default(100),
  messagesOnly: z.enum(["true", "false"]).default("true").transform((value) => value === "true")
});

/**
 * Архив чатов для агентов. Две разные вещи под одним токеном:
 *
 * - инструменты чтения (`orion_chat_archive_*`, описаны в манифесте): поиск по прошлым разговорам и чтение одного —
 *   через `AgentModuleToolsService.run` (разрешение, модуль включён, журнал);
 * - импорт транскриптов (`import-state`, `import-file`) — для скрипта-хука `scripts/chat-archive-push.mjs`, а не для модели.
 *   Проверяются разрешение `chat-archive.conversation.create` и включённость модуля, но не лимит записей в час и не журнал
 *   агента: хук срабатывает после каждого ответа и забил бы и то и другое повторами одного дела. Разрешение выдаётся
 *   галочкой инструмента `orion_chat_archive_import` (токен нельзя выпустить с разрешением, которого нет ни у одного
 *   инструмента) — тот же импорт JSON-телом для разового сохранения небольшого файла самим агентом.
 *
 * Архив пишется и читается от имени владельца токена — тот же личный архив, что он видит в панели.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/chat-archive")
export class ChatArchiveAgentController {
  constructor(
    private readonly service: ChatArchiveService,
    private readonly tools: AgentModuleToolsService,
    private readonly modules: ModulesService
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

  @Get("import-state")
  async importState(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(chatArchiveImportStateQuerySchema)) query: ChatArchiveImportStateQuery
  ): Promise<ChatArchiveImportState> {
    const agent = await this.assertCanImport(req);
    return this.service.importState(agent.userId, agent.workspaceId, query);
  }

  /** Инструмент `orion_chat_archive_import`: пачка строк JSON-телом, как любая запись агента (лимит в час, журнал). */
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

  /** Хук: пачка строк файлом (multipart, поле `lines`), без лимита записей и журнала — см. комментарий класса. */
  @Post("import-file")
  @UseInterceptors(linesInterceptor())
  async importFile(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(chatArchiveImportQuerySchema)) query: ChatArchiveImportQuery,
    @UploadedFile() file: UploadedLinesFile | undefined
  ): Promise<ChatArchiveImportResult> {
    const agent = await this.assertCanImport(req);
    return this.service.importLines(agent.userId, agent.workspaceId, query, linesFromUpload(file));
  }

  private async assertCanImport(req: AgentRequest): Promise<AgentContext> {
    const agent = req.agent as AgentContext;
    const decision = decideAgentModuleOperation(agent, "chat-archive.conversation.create", "create");
    if (decision.kind !== "allow") throw new ForbiddenException(decision.kind === "deny" ? decision.reason : "Импорт архива не подтверждается запросом");
    await this.modules.assertEnabled(agent.userId, agent.workspaceId, "chat-archive");
    return agent;
  }
}
