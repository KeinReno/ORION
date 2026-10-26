import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { TaskIntegrationReaderModule } from "../tasks/public/task-integration-reader.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { TimeAgentController } from "./time.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TimeController } from "./time.controller";
import { TimeService } from "./time.service";
import { TimeProjectAggregates } from "./time-project-aggregates";
import { TaskClosureRegistryModule } from "../tasks/public/task-closure-registry";
import { TimeTaskClosureBridge } from "./time-task-closure.service";

/** ORION v0.18 «Учёт времени» — one controller/service pair, like notes/ or tasks/. */
@Module({
  imports: [ProjectReferencesModule, TaskIntegrationReaderModule, AuthModule, WorkspacesModule, AgentCoreModule, TaskClosureRegistryModule],
  controllers: [TimeController, TimeAgentController],
  providers: [TimeProjectAggregates, TimeService, TimeTaskClosureBridge]
})
export class TimeModule {}
