import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunitiesService } from "./opportunities.service";
import { OPPORTUNITIES_IMPORT_PORT } from "./import-contract";

@Module({ imports: [AuthModule, ModulesModule, WorkspacesModule], controllers: [OpportunitiesController], providers: [OpportunitiesService, { provide: OPPORTUNITIES_IMPORT_PORT, useExisting: OpportunitiesService }], exports: [OPPORTUNITIES_IMPORT_PORT] })
export class OpportunitiesModule {}
