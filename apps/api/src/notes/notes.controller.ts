import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  attachNoteDocumentInputSchema,
  createNoteInputSchema,
  noteViewSchema,
  renameNoteTagInputSchema,
  restoreNoteRevisionInputSchema,
  updateNoteInputSchema,
  type AttachNoteDocumentInput,
  type CreateNoteInput,
  type Note,
  type NoteAttachment,
  type NoteBacklink,
  type NoteRevision,
  type NoteRevisionSummary,
  type NoteTitleRef,
  type NoteView,
  type RenameNoteTagInput,
  type RestoreNoteRevisionInput,
  type UpdateNoteInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { fixMultipartFilename, MAX_UPLOAD_BYTES } from "../common/multipart";
import type { RequestUser } from "../auth/jwt.strategy";
import type { UploadedDocumentFile } from "../documents/documents.service";
import { RequireModule } from "../modules/require-module";
import { NoteAttachmentsService } from "./note-attachments.service";
import { NotesService } from "./notes.service";

@RequireModule("notes")
@Controller("workspaces/:workspaceId/notes")
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly attachments: NoteAttachmentsService
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("search") search?: string,
    @Query("view") view?: string,
    @Query("templates") templates?: string
  ): Promise<Note[]> {
    // Unknown/absent view falls back to "active" rather than 400 — the param
    // is a UI convenience, not part of the contract worth rejecting on.
    const parsed: NoteView = noteViewSchema.safeParse(view).success ? (view as NoteView) : "active";
    return this.notes.list(user.userId, workspaceId, search, parsed, templates === "1" || templates === "true");
  }

  /** `{ id, title }` for every live note — feeds the `[[wiki link]]` autocomplete. */
  @Get("titles")
  listTitles(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<NoteTitleRef[]> {
    return this.notes.listTitles(user.userId, workspaceId);
  }

  /** Rename/merge a tag across the whole workspace. */
  @Post("tags/rename")
  renameTag(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(renameNoteTagInputSchema)) body: RenameNoteTagInput
  ): Promise<{ updated: number }> {
    return this.notes.renameTag(user.userId, workspaceId, body);
  }

  /** Remove a tag from every note in the workspace. */
  @Delete("tags/:tag")
  deleteTag(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tag") tag: string
  ): Promise<{ updated: number }> {
    return this.notes.deleteTag(user.userId, workspaceId, decodeURIComponent(tag));
  }

  // --- Вложения заметок ---------------------------------------------------
  // Declared before the `:noteId/...` routes further down (static segments are
  // matched in declaration order) and all three first segments are `:noteId`,
  // so none of them can be swallowed by `@Get(":noteId")`-style paths.

  /** Files attached to the note — each one is a `Document`, joined for name/mime/size. */
  @Get(":noteId/attachments")
  listAttachments(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<NoteAttachment[]> {
    return this.attachments.list(user.userId, workspaceId, noteId);
  }

  /** Attach a document that already exists in this workspace (`{ documentId }`). */
  @Post(":noteId/attachments")
  attachDocument(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(attachNoteDocumentInputSchema)) body: AttachNoteDocumentInput
  ): Promise<NoteAttachment> {
    return this.attachments.attachExisting(user.userId, workspaceId, noteId, body.documentId);
  }

  /**
   * Multipart upload (same shape and size limit as `documents/upload`). Files
   * land in the "Вложения заметок" folder of the Документы module and are
   * linked to the note.
   */
  @Post(":noteId/attachments/upload")
  @UseInterceptors(FilesInterceptor("files", 20, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadAttachments(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @UploadedFiles() files: UploadedDocumentFile[]
  ): Promise<NoteAttachment[]> {
    const decoded = (files ?? []).map((f) => ({ ...f, originalname: fixMultipartFilename(f.originalname) }));
    return this.attachments.upload(user.userId, workspaceId, noteId, decoded);
  }

  /** Detach a file — the Document itself stays in "Документы". */
  @Delete(":noteId/attachments/:attachmentId")
  removeAttachment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Param("attachmentId") attachmentId: string
  ): Promise<void> {
    return this.attachments.remove(user.userId, workspaceId, noteId, attachmentId);
  }

  @Get(":noteId/backlinks")
  backlinks(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<NoteBacklink[]> {
    return this.notes.backlinks(user.userId, workspaceId, noteId);
  }

  @Get(":noteId/revisions")
  listRevisions(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<NoteRevisionSummary[]> {
    return this.notes.listRevisions(user.userId, workspaceId, noteId);
  }

  @Get(":noteId/revisions/:revisionId")
  getRevision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Param("revisionId") revisionId: string
  ): Promise<NoteRevision> {
    return this.notes.getRevision(user.userId, workspaceId, noteId, revisionId);
  }

  @Post(":noteId/revisions/:revisionId/restore")
  restoreRevision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Param("revisionId") revisionId: string,
    @Body(new ZodValidationPipe(restoreNoteRevisionInputSchema)) body: RestoreNoteRevisionInput
  ): Promise<Note> {
    return this.notes.restoreRevision(user.userId, workspaceId, noteId, revisionId, body.expectedRevision);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createNoteInputSchema)) body: CreateNoteInput
  ): Promise<Note> {
    return this.notes.create(user.userId, workspaceId, body);
  }

  /** Open (or create) today's daily note for this workspace. */
  @Post("daily")
  openDaily(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<Note> {
    return this.notes.openDaily(user.userId, workspaceId);
  }

  @Patch(":noteId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(updateNoteInputSchema)) body: UpdateNoteInput
  ): Promise<Note> {
    return this.notes.update(user.userId, workspaceId, noteId, body);
  }

  /** Soft delete — the note goes to the trash and can be restored. */
  @Delete(":noteId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<void> {
    return this.notes.remove(user.userId, workspaceId, noteId);
  }

  @Post(":noteId/restore")
  restore(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<Note> {
    return this.notes.restore(user.userId, workspaceId, noteId);
  }

  /** Irreversible hard delete from the trash. */
  @Delete(":noteId/purge")
  purge(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<void> {
    return this.notes.purge(user.userId, workspaceId, noteId);
  }
}
