import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentTrashPurgeService } from "./document-trash-purge.service";
import { DocumentsProjectAggregates } from "./documents-project-aggregates";

/**
 * ORION v0.12 "Документы" — mirrors NotesModule. The StorageAdapter comes
 * from the @Global StorageModule, so it isn't imported here.
 *
 * `DocumentsService` is exported for `NotesModule`: a note attachment is a
 * link to a Document, and its files are uploaded through this service (into
 * one shared folder), never through a second file-storage implementation.
 * The dependency is one-way — this module must not import NotesModule.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [DocumentsController],
  providers: [DocumentsProjectAggregates, DocumentsService, DocumentTrashPurgeService],
  exports: [DocumentsService]
})
export class DocumentsModule {}
