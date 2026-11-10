import type { Prisma } from "@prisma/client";
import type { DocumentItem } from "@orion/shared-types";

export interface UploadedDocumentFile { originalname: string; mimetype: string; size: number; buffer: Buffer; relativePath?: string }
export type AttachmentDocument = {
  id: string; kind: "file" | "folder"; deletedAt: Date | null;
  name: string; mimeType: string | null; sizeBytes: number | null;
};

/** Existing document storage for note attachments, not a second blob store. */
export abstract class DocumentAttachmentStore {
  abstract describeTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<AttachmentDocument[]>;
  abstract upload(userId: string, workspaceId: string, files: UploadedDocumentFile[]): Promise<DocumentItem[]>;
}
