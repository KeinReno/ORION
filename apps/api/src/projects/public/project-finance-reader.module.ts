import { Module } from "@nestjs/common";
import { ProjectFinanceQueries } from "../project-finance-reader.service";
import { ProjectFinanceReader } from "./project-finance-reader";

/** SDK only: no ProjectsModule, controllers or scheduled work. */
@Module({ providers: [{ provide: ProjectFinanceReader, useClass: ProjectFinanceQueries }], exports: [ProjectFinanceReader] })
export class ProjectFinanceReaderModule {}
