import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxRegistryModule } from "./inbox-registry.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

@Module({ imports: [ProjectReferencesModule, AuthModule, WorkspacesModule, InboxRegistryModule], controllers: [InboxController], providers: [InboxService], exports: [InboxService] })
export class InboxModule {}
