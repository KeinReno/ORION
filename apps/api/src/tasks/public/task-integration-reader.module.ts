import { Module } from "@nestjs/common";
import { TaskIntegrationQueries } from "../task-integration-reader.service";
import { TaskIntegrationReader } from "./task-integration-reader";

/** SDK only: no TasksModule, controllers or scheduled work. */
@Module({ providers: [{ provide: TaskIntegrationReader, useClass: TaskIntegrationQueries }], exports: [TaskIntegrationReader] })
export class TaskIntegrationReaderModule {}
