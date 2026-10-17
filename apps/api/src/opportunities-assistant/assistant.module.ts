import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OpportunitiesModule } from "../opportunities/public";
import { ProfilesModule } from "../opportunities-profiles/public";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";
import { ASSISTANT_AUTOMATION_PORT } from "./automation-contract";
import { ASSISTANT_DRAFT_PORT } from "./draft-contract";

@Module({ imports: [AuthModule, WorkspacesModule, OpportunitiesModule, ProfilesModule], controllers: [AssistantController], providers: [AssistantService, { provide: ASSISTANT_DRAFT_PORT, useExisting: AssistantService }, { provide: ASSISTANT_AUTOMATION_PORT, useExisting: AssistantService }], exports: [ASSISTANT_DRAFT_PORT, ASSISTANT_AUTOMATION_PORT] })
export class AssistantModule {}
