import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { NotesModule } from "../notes/notes.module";
import { ProjectsModule } from "../projects/projects.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentTokenGuard } from "./agent-token.guard";
import { AgentJobsService } from "./agent-jobs.service";
import { AgentTokensService } from "./agent-tokens.service";
import { AgentTokensController, AiController } from "./ai.controller";

/** ORION AI Bridge (ADR-0007): scoped, audited, revocable access for external AI agents. */
@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule, TasksModule, NotesModule, ProjectsModule],
  controllers: [AgentTokensController, AiController],
  providers: [AgentTokensService, AgentJobsService, AgentTokenGuard]
})
export class AiModule {}
