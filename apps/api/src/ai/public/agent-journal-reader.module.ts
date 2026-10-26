import { Module } from "@nestjs/common";
import { AgentJournalQueries } from "../agent-journal-reader.service";
import { AgentJournalReader } from "./agent-journal-reader";

@Module({ providers: [{ provide: AgentJournalReader, useClass: AgentJournalQueries }], exports: [AgentJournalReader] })
export class AgentJournalReaderModule {}
