import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { OpportunitiesModule } from "../opportunities/public";
import { ProfilesModule } from "../opportunities-profiles/public";
import { HhImportController } from "./hh-import.controller";
import { HhImportService } from "./hh-import.service";
@Module({ imports: [AuthModule, WorkspacesModule, OpportunitiesModule, ProfilesModule], controllers: [HhImportController], providers: [HhImportService] })
export class HhImportModule {}
