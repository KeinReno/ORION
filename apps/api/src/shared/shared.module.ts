import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsModule } from "../documents/documents.module";
import { GrantsController } from "./grants.controller";
import { SharedController } from "./shared.controller";
import { SharedGrantsService } from "./shared-grants.service";
import { SharedService } from "./shared.service";

@Module({
  // DocumentsModule: `SharedService.getDocumentContent` reuses
  // `DocumentsService.openContentForGrant` for the on-disk key resolution
  // instead of duplicating the storage-key/folder-chain logic here.
  imports: [AuthModule, WorkspacesModule, DocumentsModule],
  controllers: [GrantsController, SharedController],
  providers: [SharedGrantsService, SharedService]
})
export class SharedGrantModule {}
