import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectHierarchyRepository } from "../project-hierarchy.repository";
import { ProjectHistoryService } from "../project-history.service";
import { ProjectsService } from "../projects.service";
import { ProjectCatalog } from "./project-catalog";

/** Canonical project service without controllers or domain lifecycle providers. */
@Module({
  imports: [WorkspacesModule],
  providers: [
    ProjectsService,
    ProjectHistoryService,
    ProjectHierarchyRepository,
    { provide: ProjectCatalog, useExisting: ProjectsService }
  ],
  exports: [ProjectCatalog, ProjectsService]
})
export class ProjectCatalogModule {}
