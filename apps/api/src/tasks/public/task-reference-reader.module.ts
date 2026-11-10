import { Module } from "@nestjs/common";
import { TaskReferenceQueries } from "../task-reference-reader.service";
import { TaskReferenceReader } from "./task-reference-reader";

@Module({ providers: [{ provide: TaskReferenceReader, useClass: TaskReferenceQueries }], exports: [TaskReferenceReader] })
export class TaskReferenceReaderModule {}
