import { Module } from "@nestjs/common";
import { TaskTimeQueries } from "../task-time-reader.service";
import { TaskTimeReader } from "./task-time-reader";

@Module({ providers: [{ provide: TaskTimeReader, useClass: TaskTimeQueries }], exports: [TaskTimeReader] })
export class TaskTimeReaderModule {}
