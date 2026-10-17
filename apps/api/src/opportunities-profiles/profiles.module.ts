import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProfilesController } from "./profiles.controller";
import { ProfilesService } from "./profiles.service";
import { PROFILE_IMPORT_PORT } from "./import-contract";
import { PROFILE_EVIDENCE_PORT } from "./evidence-contract";
@Module({ imports: [AuthModule, WorkspacesModule], controllers: [ProfilesController], providers: [ProfilesService, { provide: PROFILE_IMPORT_PORT, useExisting: ProfilesService }, { provide: PROFILE_EVIDENCE_PORT, useExisting: ProfilesService }], exports: [PROFILE_IMPORT_PORT, PROFILE_EVIDENCE_PORT] })
export class ProfilesModule {}
