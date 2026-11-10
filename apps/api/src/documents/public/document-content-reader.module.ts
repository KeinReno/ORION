import { Module } from "@nestjs/common";
import { DocumentsCoreModule } from "../documents-core.module";
import { DocumentsService } from "../documents.service";
import { DocumentContentReader } from "./document-content-reader";

@Module({
  imports: [DocumentsCoreModule],
  providers: [{ provide: DocumentContentReader, useExisting: DocumentsService }],
  exports: [DocumentContentReader]
})
export class DocumentContentReaderModule {}
