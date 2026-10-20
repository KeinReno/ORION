import { Controller, ForbiddenException, Get, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import {
  chatArchiveImportQuerySchema,
  chatArchiveImportStateQuerySchema,
  decideAgentModuleOperation,
  type ChatArchiveImportQuery,
  type ChatArchiveImportResult,
  type ChatArchiveImportState,
  type ChatArchiveImportStateQuery
} from "@orion/shared-types";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import type { AgentContext } from "../../ai/agent-tokens.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ModulesService } from "../../modules/modules.service";
import { linesFromUpload, linesInterceptor, type UploadedLinesFile } from "./chat-archive.controller";
import { ChatArchiveService } from "./chat-archive.service";

/**
 * Импорт транскриптов скриптом-хуком `chat-archive-push.mjs` — по токену агента, но не для модели: это не инструмент
 * MCP и не часть каталога `ai/v1` (поэтому отдельный контроллер, а не `ChatArchiveAgentController` из манифеста).
 *
 * Проверяются разрешение `chat-archive.conversation.create` и включённость модуля, но не лимит записей в час и не журнал
 * агента: хук срабатывает после каждого ответа и забил бы и то и другое повторами одного дела. Разрешение выдаётся
 * галочкой инструмента `orion_chat_archive_import` (токен нельзя выпустить с разрешением, которого нет ни у одного
 * инструмента). Архив пишется от имени владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/chat-archive/hook")
export class ChatArchiveHookController {
  constructor(
    private readonly service: ChatArchiveService,
    private readonly modules: ModulesService
  ) {}

  @Get("state")
  async state(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(chatArchiveImportStateQuerySchema)) query: ChatArchiveImportStateQuery
  ): Promise<ChatArchiveImportState> {
    const agent = await this.assertCanImport(req);
    return this.service.importState(agent.userId, agent.workspaceId, query);
  }

  /** Пачка строк файлом (multipart, поле `lines`). */
  @Post("lines")
  @UseInterceptors(linesInterceptor())
  async lines(
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
