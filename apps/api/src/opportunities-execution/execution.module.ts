import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssistantModule } from "../opportunities-assistant/public";
import { ProfilesModule } from "../opportunities-profiles/public";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EXECUTION_AUTOMATION_PORT } from "./automation-contract";
import { ExecutionController } from "./execution.controller";
import { ExecutionService } from "./execution.service";
import { RunnerAuthGuard } from "./runner-auth.guard";
import { RunnerController } from "./runner.controller";
import { RunnerService } from "./runner.service";
import { ExecutionAuthorityRegistry } from "./authority-registry";

@Module({ imports: [AuthModule, WorkspacesModule, AssistantModule, ProfilesModule], controllers: [ExecutionController, RunnerController], providers: [ExecutionService, RunnerService, RunnerAuthGuard, ExecutionAuthorityRegistry, { provide: EXECUTION_AUTOMATION_PORT, useExisting: ExecutionService }], exports: [EXECUTION_AUTOMATION_PORT, ExecutionAuthorityRegistry] })
export class ExecutionModule {}
