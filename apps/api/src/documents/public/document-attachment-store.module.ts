import { Module } from "@nestjs/common";
import { DocumentsCoreModule } from "../documents-core.module";
import { DocumentAttachmentStorage } from "../document-attachment-store.service";
import { DocumentAttachmentStore } from "./document-attachment-store";

@Module({ imports: [DocumentsCoreModule], providers: [{ provide: DocumentAttachmentStore, useClass: DocumentAttachmentStorage }], exports: [DocumentAttachmentStore] })
export class DocumentAttachmentStoreModule {}
