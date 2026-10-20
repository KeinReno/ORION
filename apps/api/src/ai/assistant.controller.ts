import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  assistantChatInputSchema,
  assistantSendInputSchema,
  setAssistantKeyInputSchema,
  setAssistantModelInputSchema,
  type AssistantChatInput,
  type AssistantChatResult,
  type AssistantConversation,
  type AssistantConversationSummary,
  type AssistantEngineStatus,
  type AssistantSendInput,
  type AssistantSendResult,
  type AssistantKeyStatus,
  type SetAssistantKeyInput,
  type SetAssistantModelInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AssistantChatService } from "./assistant-chat.service";
import { AssistantKeyService } from "./assistant-key.service";

/** Чат-ассистент ORION (ADR-0017, вариант C): ключ владельца и обмен с моделью. Ключ наружу не отдаётся. */
@UseGuards(JwtAuthGuard)
@Controller()
export class AssistantController {
  constructor(
    private readonly keys: AssistantKeyService,
    private readonly chat: AssistantChatService
  ) {}

  @Get("assistant/key")
  keyStatus(@CurrentUser() user: RequestUser): Promise<AssistantKeyStatus> {
    return this.keys.status(user.userId);
  }

  @Put("assistant/key")
  saveKey(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(setAssistantKeyInputSchema)) body: SetAssistantKeyInput): Promise<AssistantKeyStatus> {
    return this.keys.save(user.userId, body);
  }

  @Patch("assistant/key")
  setModel(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(setAssistantModelInputSchema)) body: SetAssistantModelInput): Promise<AssistantKeyStatus> {
    return this.keys.setModel(user.userId, body.model);
  }

  /** Who can answer in the chat on this computer: the key, Codex, Cursor — with what is missing for the rest. */
  @Get("assistant/engines")
  engines(@CurrentUser() user: RequestUser): Promise<AssistantEngineStatus[]> {
    return this.chat.engines(user.userId);
  }

  @Delete("assistant/key")
  @HttpCode(204)
  async clearKey(@CurrentUser() user: RequestUser): Promise<void> {
    await this.keys.clear(user.userId);
  }

  @Post("workspaces/:workspaceId/assistant/chat")
  send(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(assistantChatInputSchema)) body: AssistantChatInput,
    @Req() req: { socket: { localPort?: number } }
  ): Promise<AssistantChatResult> {
    // Инструменты ассистента вызываются на этом же процессе: адрес loopback строим из порта, на котором принят запрос.
    return this.chat.chat(user.userId, workspaceId, body, `http://127.0.0.1:${req.socket.localPort}`);
  }

  /** A message in a saved conversation; `context` — what the user is looking at («эта задача»). */
  @Post("workspaces/:workspaceId/assistant/send")
  sendInConversation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(assistantSendInputSchema)) body: AssistantSendInput,
    @Req() req: { socket: { localPort?: number } }
  ): Promise<AssistantSendResult> {
    return this.chat.send(user.userId, workspaceId, body, `http://127.0.0.1:${req.socket.localPort}`);
  }

  @Get("workspaces/:workspaceId/assistant/conversations")
  conversations(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AssistantConversationSummary[]> {
    return this.chat.listConversations(user.userId, workspaceId);
  }

  @Get("workspaces/:workspaceId/assistant/conversations/:conversationId")
  conversation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string
  ): Promise<AssistantConversation> {
    return this.chat.getConversation(user.userId, workspaceId, conversationId);
  }

  @Delete("workspaces/:workspaceId/assistant/conversations/:conversationId")
  @HttpCode(204)
  async removeConversation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string
  ): Promise<void> {
    await this.chat.removeConversation(user.userId, workspaceId, conversationId);
  }
}
