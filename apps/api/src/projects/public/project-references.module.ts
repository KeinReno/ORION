import { Module } from "@nestjs/common";
import { ProjectReferenceReader } from "../project-reference-reader.service";
import { ProjectReferences } from "./project-references";

/** Reference SDK only: no ProjectsModule, controllers, cron or lifecycle side effects. */
@Module({ providers: [{ provide: ProjectReferences, useClass: ProjectReferenceReader }], exports: [ProjectReferences] })
export class ProjectReferencesModule {}
