import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  chatArchiveImportQuerySchema,
  chatArchiveImportStateQuerySchema,
  chatArchiveLinesQuerySchema,
  chatArchiveRawQuerySchema,
  chatArchiveSearchQuerySchema,
  chatArchiveSourceSchema,
  setChatArchiveAutoSourceInputSchema,
  updateChatArchiveConversationInputSchema,
  type ChatArchiveAutoSource,
  type ChatArchiveConversation,
  type ChatArchiveImportQuery,
  type ChatArchiveImportResult,
  type ChatArchiveImportState,
  type ChatArchiveImportStateQuery,
  type ChatArchiveLinesPage,
  type ChatArchiveLinesQuery,
  type ChatArchiveRawPage,
  type ChatArchiveRawQuery,
  type ChatArchiveSearchHit,
  type ChatArchiveSearchQuery,
  type SetChatArchiveAutoSourceInput,
  type UpdateChatArchiveConversationInput
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { CHAT_ARCHIVE_IMPORT_MAX_BYTES, ChatArchiveService } from "./chat-archive.service";

/** Файл пачки импорта: строки транскрипта, каждая с "\n" на конце. Без завершающего "\n" — значит, строка оборвана. */
export interface UploadedLinesFile {
  buffer: Buffer;
}

export function linesFromUpload(file: UploadedLinesFile | undefined): string[] {
  if (!file?.buffer?.length) throw new BadRequestException("Нет строк для импорта (поле lines)");
  const text = file.buffer.toString("utf8");
  if (!text.endsWith("\n")) throw new BadRequestException("Последняя строка оборвана: каждая строка должна заканчиваться переводом строки");
  return text.slice(0, -1).split("\n");
}

export const linesInterceptor = () => FileInterceptor("lines", { limits: { fileSize: CHAT_ARCHIVE_IMPORT_MAX_BYTES } });

@RequireModule("chat-archive")
@Controller("workspaces/:workspaceId/chat-archive")
export class ChatArchiveController {
  constructor(private readonly service: ChatArchiveService) {}

  @Get("conversations")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("source", new ZodValidationPipe(chatArchiveSourceSchema.optional())) source?: ChatArchiveConversation["source"]
  ): Promise<ChatArchiveConversation[]> {
    return this.service.list(user.userId, workspaceId, source);
  }

  @Get("conversations/:conversationId")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string): Promise<ChatArchiveConversation> {
    return this.service.get(user.userId, workspaceId, conversationId);
  }

  @Get("conversations/:conversationId/lines")
  lines(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string,
    @Query(new ZodValidationPipe(chatArchiveLinesQuerySchema)) query: ChatArchiveLinesQuery
  ): Promise<ChatArchiveLinesPage> {
    return this.service.lines(user.userId, workspaceId, conversationId, query);
  }

  @Get("conversations/:conversationId/raw")
  raw(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string,
    @Query(new ZodValidationPipe(chatArchiveRawQuerySchema)) query: ChatArchiveRawQuery
  ): Promise<ChatArchiveRawPage> {
    return this.service.raw(user.userId, workspaceId, conversationId, query);
  }

  @Patch("conversations/:conversationId")
  rename(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(updateChatArchiveConversationInputSchema)) body: UpdateChatArchiveConversationInput
  ): Promise<ChatArchiveConversation> {
    return this.service.rename(user.userId, workspaceId, conversationId, body);
  }

  @Delete("conversations/:conversationId")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string): Promise<void> {
    await this.service.remove(user.userId, workspaceId, conversationId);
  }

  @Get("search")
  search(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(chatArchiveSearchQuerySchema)) query: ChatArchiveSearchQuery
  ): Promise<ChatArchiveSearchHit[]> {
    return this.service.search(user.userId, workspaceId, query);
  }

  /** ORION-16: явный тумблер автосбора по источнику — всегда отвечает за все известные источники, даже невключённые. */
  @Get("auto-sources")
  listAutoSources(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<ChatArchiveAutoSource[]> {
    return this.service.listAutoSources(user.userId, workspaceId);
  }

  @Put("auto-sources")
  setAutoSource(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(setChatArchiveAutoSourceInputSchema)) body: SetChatArchiveAutoSourceInput
  ): Promise<ChatArchiveAutoSource> {
    return this.service.setAutoSource(user.userId, workspaceId, body);
  }

  @Get("import-state")
  importState(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(chatArchiveImportStateQuerySchema)) query: ChatArchiveImportStateQuery
  ): Promise<ChatArchiveImportState> {
    return this.service.importState(user.userId, workspaceId, query);
  }

  /** Пачка строк файла (multipart, поле `lines`); параметры — в строке запроса. Импорт файла из панели. */
  @Post("import")
  @UseInterceptors(linesInterceptor())
  import(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(chatArchiveImportQuerySchema)) query: ChatArchiveImportQuery,
    @UploadedFile() file: UploadedLinesFile | undefined
  ): Promise<ChatArchiveImportResult> {
    return this.service.importLines(user.userId, workspaceId, query, linesFromUpload(file));
  }
}
