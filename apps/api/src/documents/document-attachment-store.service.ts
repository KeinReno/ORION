import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { DocumentsService } from "./documents.service";
import { DocumentAttachmentStore, type UploadedDocumentFile } from "./public/document-attachment-store";

const ATTACHMENTS_FOLDER = "Вложения заметок";

@Injectable()
export class DocumentAttachmentStorage extends DocumentAttachmentStore {
  constructor(private readonly documents: DocumentsService) { super(); }
  describeTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    return tx.document.findMany({ where: { workspaceId, id: { in: ids } },
      select: { id: true, kind: true, deletedAt: true, name: true, mimeType: true, sizeBytes: true } });
  }
  async upload(userId: string, workspaceId: string, files: UploadedDocumentFile[]) {
    const documents = await this.documents.list(userId, workspaceId);
    const existing = documents.find(doc => doc.kind === "folder" && doc.parentId === null &&
      doc.name.toLowerCase() === ATTACHMENTS_FOLDER.toLowerCase());
    const folderId = existing?.id ?? (await this.documents.createFolder(userId, workspaceId,
      { parentId: null, name: ATTACHMENTS_FOLDER })).id;
    return this.documents.upload(userId, workspaceId, folderId, files);
  }
}
