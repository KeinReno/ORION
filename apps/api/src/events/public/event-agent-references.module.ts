import { Module } from "@nestjs/common";
import { EventAgentReferencesQueries } from "../event-agent-references.service";
import { EventAgentReferences } from "./event-agent-references";

@Module({ providers: [{ provide: EventAgentReferences, useClass: EventAgentReferencesQueries }], exports: [EventAgentReferences] })
export class EventAgentReferencesModule {}
