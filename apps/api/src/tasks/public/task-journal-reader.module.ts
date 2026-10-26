import { Module } from "@nestjs/common";
import { TaskJournalQueries } from "../task-journal-reader.service";
import { TaskJournalReader } from "./task-journal-reader";

@Module({ providers: [{ provide: TaskJournalReader, useClass: TaskJournalQueries }], exports: [TaskJournalReader] })
export class TaskJournalReaderModule {}
