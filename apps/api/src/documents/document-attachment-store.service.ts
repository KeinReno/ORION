import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { DocumentsService } from "./documents.service";
import { sanitizeSegment } from "@orion/shared-types";
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
    const folderId = await this.ensureFolder(userId, workspaceId, null, ATTACHMENTS_FOLDER);
    const folders = new Map<string, string>([["", folderId]]);
    const uploaded: Array<Awaited<ReturnType<DocumentsService["upload"]>>[number] | undefined> = [];
    for (const [fileIndex, file] of files.entries()) {
      const path = (file.relativePath ?? file.originalname).replace(/\\/g, "/");
      const segments = path.split("/").filter(Boolean).map((part) => sanitizeSegment(part));
      const name = segments.pop() || sanitizeSegment(file.originalname || "file");
      let parentId = folderId;
      let prefix = "";
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        const cached = folders.get(prefix);
        if (cached) parentId = cached;
        else {
          parentId = await this.ensureFolder(userId, workspaceId, parentId, segment);
          folders.set(prefix, parentId);
        }
      }
      const rows = await this.documents.upload(userId, workspaceId, parentId, [{ ...file, originalname: name }]);
      uploaded[fileIndex] = rows[0];
    }
    return uploaded.filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  /**
   * Concurrent uploads can both observe a missing folder and race the unique
   * workspace/path index. If the other request wins, reuse its folder instead
   * of failing an otherwise valid attachment upload.
   */
  private async ensureFolder(userId: string, workspaceId: string, parentId: string | null, name: string): Promise<string> {
    const find = async () => (await this.documents.list(userId, workspaceId)).find((item) =>
      item.kind === "folder" && item.parentId === parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    const existing = await find();
    if (existing) return existing.id;
    try {
      return (await this.documents.createFolder(userId, workspaceId, { parentId, name })).id;
    } catch (error) {
      const concurrent = await find();
      if (concurrent) return concurrent.id;
      throw error;
    }
  }
}
