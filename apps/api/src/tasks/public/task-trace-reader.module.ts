import { Module } from "@nestjs/common";
import { TaskTraceQueries } from "../task-trace-reader.service";
import { TaskTraceReader } from "./task-trace-reader";

@Module({
  providers: [{ provide: TaskTraceReader, useClass: TaskTraceQueries }],
  exports: [TaskTraceReader]
})
export class TaskTraceReaderModule {}
