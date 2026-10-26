import { Module } from "@nestjs/common";
import { NoteAgentReferencesQueries } from "../note-agent-references.service";
import { NoteAgentReferences } from "./note-agent-references";

@Module({ providers: [{ provide: NoteAgentReferences, useClass: NoteAgentReferencesQueries }], exports: [NoteAgentReferences] })
export class NoteAgentReferencesModule {}
