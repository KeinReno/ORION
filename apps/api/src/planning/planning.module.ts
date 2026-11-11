import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { EventOperationsModule } from "../events/public/event-operations.module";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { TaskIntegrationReaderModule } from "../tasks/public/task-integration-reader.module";
import { TaskFieldReaderModule } from "../tasks/public/task-field-reader.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { MilestoneTimelineModule } from "../milestones/public/milestone-timeline.module";
import { PlanningController } from "./planning.controller";
import { PlanningBlocksService } from "./planning-blocks.service";
import { PlanningGanttService } from "./planning-gantt.service";
import { PlanningMatrixService } from "./planning-matrix.service";
import { PlanningMatrixPresetsService } from "./planning-matrix-presets.service";

/**
 * «Планирование» (задание 04): тайм-блоки, Гантт с критическим путём, матрица.
 *
 * Никаких чужих таблиц: задачи и пользовательские поля — через публичные
 * контракты Tasks, вехи — milestones, события — Events, проект — ProjectReferences.
 * Поэтому выключение соседа не ломает модуль: представления просто пустеют.
 */
@Module({
  imports: [
    AuthModule,
    WorkspacesModule,
    EventOperationsModule,
    TaskOperationsModule,
    TaskIntegrationReaderModule,
    TaskFieldReaderModule,
    ProjectReferencesModule,
    MilestoneTimelineModule
  ],
  controllers: [PlanningController],
  providers: [PlanningBlocksService, PlanningGanttService, PlanningMatrixService, PlanningMatrixPresetsService]
})
export class PlanningModule {}
