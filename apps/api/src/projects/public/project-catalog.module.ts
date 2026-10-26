import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectsService } from "../projects.service";
import { ProjectCatalog } from "./project-catalog";

/** Canonical project service without controllers or domain lifecycle providers. */
@Module({
  imports: [WorkspacesModule],
  providers: [ProjectsService, { provide: ProjectCatalog, useExisting: ProjectsService }],
  exports: [ProjectCatalog, ProjectsService]
})
export class ProjectCatalogModule {}
