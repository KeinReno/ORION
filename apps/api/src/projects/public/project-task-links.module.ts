import { Module } from "@nestjs/common";
import { ProjectTaskLinkQueries } from "../project-task-links.service";
import { ProjectTaskLinks } from "./project-task-links";

/** SDK only; no full domain module or lifecycle side effects. */
@Module({ providers: [{ provide: ProjectTaskLinks, useClass: ProjectTaskLinkQueries }], exports: [ProjectTaskLinks] })
export class ProjectTaskLinksModule {}
