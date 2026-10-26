import { Module } from "@nestjs/common";
import { TaskProposalQueries } from "../task-proposal-reader.service";
import { TaskProposalReader } from "./task-proposal-reader";

@Module({ providers: [{ provide: TaskProposalReader, useClass: TaskProposalQueries }], exports: [TaskProposalReader] })
export class TaskProposalReaderModule {}
