import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EntityLinkOperationsModule } from "./public/entity-link-operations.module";
import { EntityLinksController } from "./entity-links.controller";

/**
 * Core connection layer (task 01.1). `EntityLinksService` is the only writer of entity_links;
 * other modules import `EntityLinkOperationsModule` (SDK) rather than this module, so they never
 * see the controller or the auth layer.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, EntityLinkOperationsModule],
  controllers: [EntityLinksController],
  exports: [EntityLinkOperationsModule]
})
export class EntityLinksModule {}
