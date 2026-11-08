import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SendCopyInput, SendDocumentsInput, SendEnableInput, SendPairInput, SendPathsInput, SendStaged, SendTransfer } from "@orion/shared-types";
import { safeRelativePath } from "@orion/shared-types";
import { DocumentsService } from "../documents/documents.service";
import { SendLink } from "./send-link";

/** Петля Nest вокруг узла передачи. По умолчанию слушатель выключен и сеть не открыта. */
@Injectable()
export class SendService implements OnModuleInit, OnModuleDestroy {
  readonly link = new SendLink({ advertise: process.env.NODE_ENV !== "test" });

  constructor(private readonly documents: DocumentsService) {}

  async onModuleInit(): Promise<void> {
    if (this.link.status().enabled) await this.link.enable({ enabled: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.link.stop();
  }

  stage(relativePath: string, source: AsyncIterable<Buffer>, batchId?: string): Promise<SendStaged> {
    return this.link.stage(relativePath, source, batchId);
  }

  async sendDocuments(userId: string, input: SendDocumentsInput): Promise<SendTransfer> {
    const batchId = randomUUID();
    for (const documentId of input.documentIds) {
      const opened = await this.documents.openContent(userId, input.workspaceId, documentId);
      const relative = safeRelativePath(opened.name.replace(/\\/g, "/")) ?? `document-${documentId.slice(0, 8)}`;
      await this.link.stage(relative, opened.stream as AsyncIterable<Buffer>, batchId);
    }
    return this.link.offerBatch(input.peerId, batchId);
  }

  sendPaths(input: SendPathsInput): Promise<SendTransfer> {
    return this.link.offerPaths(input.peerId, input.paths);
  }

  sendCopy(input: SendCopyInput): Promise<SendTransfer> {
    return this.link.offerCopy(input.peerId, input.title, input.envelope);
  }

  enable(input: SendEnableInput) {
    return this.link.enable(input);
  }

  pair(input: SendPairInput) {
    return this.link.beginPair(input);
  }
}
