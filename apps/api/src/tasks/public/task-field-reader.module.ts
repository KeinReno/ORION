import { Module } from "@nestjs/common";
import { TaskFieldQueries } from "../task-field-reader.service";
import { TaskFieldReader } from "./task-field-reader";

/** Только чтение пользовательских полей задач; без контроллеров и фоновых задач. */
@Module({
  providers: [{ provide: TaskFieldReader, useClass: TaskFieldQueries }],
  exports: [TaskFieldReader]
})
export class TaskFieldReaderModule {}
