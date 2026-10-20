import { Body, Controller, Delete, Get, NotFoundException, OnModuleInit, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  AGENT_DOCUMENT_TEXT_MAX,
  ASSISTANT_INBOX_FOLDER,
  agentDeleteRequestSchema,
  agentSearchQuerySchema,
  createFolderInputSchema,
  updateDocumentInputSchema,
  type AgentDeleteRequest,
  type AgentDocumentText,
  type AgentSearchQuery,
  type CreateFolderInput,
  type DocumentItem
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DocumentsService } from "./documents.service";

const documentChangeSchema = updateDocumentInputSchema.pick({ name: true, parentId: true, projectId: true });

/**
 * Инструменты ИИ-агента для модуля «Документы» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/documents")
export class DocumentsAgentController implements OnModuleInit {
  constructor(
    private readonly documents: DocumentsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, documentId: string) => {
      const items = await this.documents.list(userId, workspaceId);
      const item = items.find((doc) => doc.id === documentId);
      if (!item) return null;
      const folder = (id: string | null): string | null => (id ? (items.find((doc) => doc.id === id)?.name ?? id) : null);
      return {
        title: item.name,
        fields: { name: item.name, parentId: folder(item.parentId), projectId: item.projectId },
        labels: { name: "Название", parentId: "Папка", projectId: "Проект" }
      };
    };
    this.tools.register("orion_documents_update", {
      noun: "документ",
      describe,
      apply: (userId, workspaceId, documentId, args) => this.documents.update(userId, workspaceId, documentId, documentChangeSchema.parse(args))
    });
    this.tools.register("orion_documents_delete", { noun: "документ", describe, apply: (userId, workspaceId, documentId) => this.documents.remove(userId, workspaceId, documentId) });
  }

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

  @Post("folders")
  createFolder(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createFolderInputSchema)) body: CreateFolderInput): Promise<DocumentItem> {
    return this.tools.run(
      req,
      "orion_documents_create_folder",
      (agent) => this.documents.createFolder(agent.userId, agent.workspaceId, body),
      (folder) => ({ resource: `document:${folder.id}`, objectType: "document", objectId: folder.id, summary: `Создал папку «${folder.name}»` })
    );
  }

  /** A file the user just sent to the assistant sits in its inbox folder: moving it out is their own request — no confirmation. */
  @Patch(":documentId")
  async update(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("documentId") documentId: string,
    @Body(new ZodValidationPipe(documentChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    const agent = req.agent!;
    const items = await this.documents.list(agent.userId, agent.workspaceId).catch(() => [] as DocumentItem[]);
    const item = items.find((doc) => doc.id === documentId);
    const inbox = items.find((doc) => doc.kind === "folder" && doc.parentId === null && doc.name === ASSISTANT_INBOX_FOLDER);
    return this.tools.change(req, res, "orion_documents_update", documentId, body, { allowDirect: Boolean(item && inbox && item.parentId === inbox.id) });
  }

  /** To the trash, as the panel does (restorable for 30 days); a folder goes with its contents. */
  @Delete(":documentId")
  remove(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("documentId") documentId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_documents_delete", documentId, {}, { reason: body.reason });
  }
}
