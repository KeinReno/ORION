import { Module } from "@nestjs/common";
import { TaskOverviewQueries } from "../task-overview-reader.service";
import { TaskOverviewReader } from "./task-overview-reader";

@Module({ providers: [{ provide: TaskOverviewReader, useClass: TaskOverviewQueries }], exports: [TaskOverviewReader] })
export class TaskOverviewReaderModule {}
