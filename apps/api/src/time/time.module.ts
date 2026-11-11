import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { TaskIntegrationReaderModule } from "../tasks/public/task-integration-reader.module";
import { TaskEstimateReaderModule } from "../tasks/public/task-estimate-reader.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { TimeAgentController } from "./time.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TimeController } from "./time.controller";
import { TimeService } from "./time.service";
import { TimeAnalyticsService } from "./time-analytics.service";
import { TimeProjectAggregates } from "./time-project-aggregates";
import { TaskClosureRegistryModule } from "../tasks/public/task-closure-registry";
import { TimeTaskClosureBridge } from "./time-task-closure.service";

/** ORION v0.18 «Учёт времени» — один controller/service pair, как notes/ или tasks/. */
@Module({
  imports: [
    ProjectReferencesModule,
    TaskIntegrationReaderModule,
    // План/факт по задачам читает только оценку через узкий публичный контракт:
    // полный TaskOperations подтянул бы TasksService и лишил Time самостоятельности.
    TaskEstimateReaderModule,
    AuthModule,
    WorkspacesModule,
    AgentCoreModule,
    TaskClosureRegistryModule
  ],
  controllers: [TimeController, TimeAgentController],
  providers: [TimeProjectAggregates, TimeService, TimeAnalyticsService, TimeTaskClosureBridge]
})
export class TimeModule {}
