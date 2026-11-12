import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { EntityLinksService } from "../entity-links.service";
import { EntityLinkOperations } from "./entity-link-operations";

/**
 * SDK surface deliberately does not import the controller: a module that only needs to write a
 * link must not mount the HTTP routes or depend on the auth layer.
 */
@Module({
  imports: [WorkspacesModule],
  providers: [EntityLinksService, { provide: EntityLinkOperations, useFactory: (service: EntityLinksService): EntityLinkOperations => service, inject: [EntityLinksService] }],
  exports: [EntityLinkOperations, EntityLinksService]
})
export class EntityLinkOperationsModule {}
