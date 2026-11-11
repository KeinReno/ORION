import { Module } from "@nestjs/common";
import { TaskEstimateQueries } from "../task-estimate-reader.service";
import { TaskEstimateReader } from "./task-estimate-reader";

/** SDK только для чтения оценки задачи: без TasksModule, контроллеров и кронов. */
@Module({
  providers: [{ provide: TaskEstimateReader, useClass: TaskEstimateQueries }],
  exports: [TaskEstimateReader]
})
export class TaskEstimateReaderModule {}
