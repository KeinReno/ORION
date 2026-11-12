import { AgentCoreModule } from "../ai/agent-core.module";
import { TaskReferenceReaderModule } from "../tasks/public/task-reference-reader.module";
import { ProjectsAgentController } from "./projects.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptureOperationsModule } from "../captures/public/capture-operations.module";
import { EntityLinkOperationsModule } from "../entity-links/public/entity-link-operations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ProjectCapturesService } from "./project-captures.service";
import { ProjectIdeasController, ProjectProblemsController } from "./project-captures.controller";
import { ProjectUpdatesController } from "./project-updates.controller";
import { ProjectUpdatesService } from "./project-updates.service";
import { ProjectLogbookController, ProjectLogbookWorkspaceController, ProjectRelationsController } from "./project-logbook.controller";
import { ProjectLogbookService } from "./project-logbook.service";
import { ProjectLogbookAutoEntriesService } from "./project-logbook-auto-entries.service";
import { ProjectsController } from "./projects.controller";
import { ProjectCatalogModule } from "./public/project-catalog.module";
import { SearchRegistryModule } from "../search/search-registry.module";
import { SearchOperationsModule } from "../search/public/search-operations.module";
import { ProjectsSearchProvider } from "./projects-search.provider";
import { MilestoneCommandsModule } from "../milestones/public/milestone-commands.module";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { ProjectTemplatesController } from "./project-templates.controller";
import { ProjectTemplatesService } from "./project-templates.service";
import { ProjectPortfolioService } from "./project-portfolio.service";
import { ProjectHistoryService } from "./project-history.service";
import { ProjectHierarchyRepository } from "./project-hierarchy.repository";

@Module({
  imports: [
    ProjectCatalogModule,
    TaskReferenceReaderModule,
    // Задание 03: шаблоны/дублирование создают задачи и вехи в СВОЕЙ транзакции —
    // только через публичные команды владельцев, не через их таблицы.
    TaskOperationsModule,
    MilestoneCommandsModule,
    AuthModule,
    WorkspacesModule,
    NotificationsModule,
    CaptureOperationsModule,
    SearchRegistryModule,
    SearchOperationsModule,
    EntityLinkOperationsModule,
    AgentCoreModule
  ],
  // `ProjectTemplatesController` — ДО `ProjectsController`: путь `projects/templates`
  // иначе перехватился бы маршрутом `projects/:projectId`.
  controllers: [
    ProjectsAgentController,
    ProjectTemplatesController,
    ProjectsController,
    ProjectUpdatesController,
    ProjectIdeasController,
    ProjectProblemsController,
    ProjectLogbookController,
    ProjectLogbookWorkspaceController,
    ProjectRelationsController
  ],
  providers: [
    ProjectUpdatesService,
    ProjectCapturesService,
    ProjectLogbookService,
    ProjectLogbookAutoEntriesService,
    ProjectsSearchProvider,
    ProjectTemplatesService,
    ProjectPortfolioService,
    ProjectHistoryService,
    ProjectHierarchyRepository
  ],
  exports: [ProjectCatalogModule]
})
export class ProjectsModule {}
