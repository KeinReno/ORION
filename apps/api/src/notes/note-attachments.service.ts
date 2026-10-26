import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type NoteAttachment as LinkRow } from "@prisma/client";
import type { NoteAttachment } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DocumentAttachmentStore, type UploadedDocumentFile } from "../documents/public/document-attachment-store";
import { ModulesService } from "../modules/modules.service";

type AttachmentRow = LinkRow & { document: { name: string; mimeType: string | null; sizeBytes: number | null } };

/**
 * ORION v0.17 "Вложения заметок" — the `note_attachments` join between a note
 * and an already-existing Document. Mirrors NotesService/DocumentsService style
 * (assertMemberTx + withUser + a hand-written `toDto`).
 *
 * Two deliberate design points:
 *  - the file lives in the Documents module (upload goes through
 *    `DocumentsService.upload`), so there is no second blob store and no second
 *    set of storage-key rules;
 *  - `remove` deletes only the *link*, never the Document — detaching a file
 *    from a note must not silently destroy it (it is a shared artifact, and a
 *    note can be one of several references to it).
 */
@Injectable()
export class NoteAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly documents: DocumentAttachmentStore,
    private readonly modules: ModulesService
  ) {}

  /** Attachments of one note, oldest first, joined with their Document. */
  async list(userId: string, workspaceId: string, noteId: string): Promise<NoteAttachment[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "documents");
      await this.assertNoteTx(tx, workspaceId, noteId);
      const links = await tx.noteAttachment.findMany({
        where: { workspaceId, noteId },
        orderBy: { createdAt: "asc" }
      });
      return this.toDtosTx(tx, workspaceId, links);
    });
    return rows;
  }

  /** Link a document that already exists in this workspace. Re-attaching the same pair → 409. */
  async attachExisting(
    userId: string,
    workspaceId: string,
    noteId: string,
    documentId: string
  ): Promise<NoteAttachment> {
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await this.modules.assertEnabledTx(tx, userId, workspaceId, "documents");
        await this.assertNoteTx(tx, workspaceId, noteId);
        await this.assertDocumentTx(tx, workspaceId, documentId);

        const existing = await tx.noteAttachment.findUnique({
          where: { noteId_documentId: { noteId, documentId } }
        });
        if (existing) throw new ConflictException("Этот документ уже привязан к заметке");

        const link = await tx.noteAttachment.create({
          data: { workspaceId, noteId, documentId }
        });
        return (await this.toDtosTx(tx, workspaceId, [link]))[0];
      });
      return row;
    } catch (error) {
      // Two clicks racing past the `findUnique` above land here instead of 500 —
      // `@@unique([noteId, documentId])` is the authority on what is a duplicate.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Этот документ уже привязан к заметке");
      }
      throw error;
    }
  }

  /**
   * Upload new files and attach them to the note. The blobs are written by
   * `DocumentsService.upload` (outside any DB transaction, like the documents
   * module does) and only then linked, so a failure mid-way leaves an unlinked
   * document in "Документы" at worst — never a link pointing at nothing.
   */
  async upload(
    userId: string,
    workspaceId: string,
    noteId: string,
    files: UploadedDocumentFile[]
  ): Promise<NoteAttachment[]> {
    if (files.length === 0) throw new BadRequestException("Нет файлов для загрузки");

    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "documents");
      await this.assertNoteTx(tx, workspaceId, noteId);
    });

    const uploaded = await this.documents.upload(userId, workspaceId, files);

    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      // Re-checked: the note may have been purged while the blobs were being written.
      await this.assertNoteTx(tx, workspaceId, noteId);
      const created: LinkRow[] = [];
      for (const document of uploaded) {
        created.push(
          await tx.noteAttachment.create({
            data: { workspaceId, noteId, documentId: document.id }
            })
        );
      }
      return this.toDtosTx(tx, workspaceId, created);
    });
    return rows;
  }

  /**
   * Detach a file from the note. Only the `note_attachments` row goes away —
   * the Document (and its blob) stays in "Документы", where the user can
   * preview it, move it, or trash it explicitly. Deleting the Document here
   * would silently destroy a file that may be linked from anywhere else, and
   * the trash cron is already the one place that removes bytes.
   */
  async remove(userId: string, workspaceId: string, noteId: string, attachmentId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertNoteTx(tx, workspaceId, noteId);
      const link = await tx.noteAttachment.findUnique({ where: { id: attachmentId } });
      if (!link || link.workspaceId !== workspaceId || link.noteId !== noteId) {
        throw new NotFoundException("Вложение не найдено");
      }
      await tx.noteAttachment.delete({ where: { id: attachmentId } });
    });
  }

  // --- helpers -------------------------------------------------------------

  private async toDtosTx(tx: Prisma.TransactionClient, workspaceId: string, links: LinkRow[]): Promise<NoteAttachment[]> {
    const documents = await this.documents.describeTx(tx, workspaceId, links.map(link => link.documentId));
    const byId = new Map(documents.map(document => [document.id, document]));
    return links.map(link => {
      const document = byId.get(link.documentId);
      if (!document) throw new NotFoundException("Документ не найден");
      return toDto({ ...link, document });
    });
  }

  /** Asserts the note belongs to this workspace (the same guard `NotesService.assertOwnedTx` applies). */
  private async assertNoteTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string): Promise<void> {
    const note = await tx.note.findUnique({ where: { id: noteId }, select: { workspaceId: true } });
    if (!note || note.workspaceId !== workspaceId) throw new NotFoundException("Заметка не найдена");
  }

  /**
   * A link may only point at a live file *of this workspace* — a user who is a
   * member of two workspaces must not be able to attach the other one's file
   * (RLS alone wouldn't stop it, both rows are visible to them).
   */
  private async assertDocumentTx(tx: Prisma.TransactionClient, workspaceId: string, documentId: string): Promise<void> {
    const document = (await this.documents.describeTx(tx, workspaceId, [documentId]))[0];
    if (!document || document.deletedAt) {
      throw new NotFoundException("Документ не найден");
    }
    if (document.kind !== "file") throw new BadRequestException("Папку нельзя привязать к заметке");
  }
}

function toDto(row: AttachmentRow): NoteAttachment {
  return {
    id: row.id,
    noteId: row.noteId,
    documentId: row.documentId,
    name: row.document.name,
    mimeType: row.document.mimeType,
    sizeBytes: row.document.sizeBytes,
    createdAt: row.createdAt.toISOString()
  };
}
