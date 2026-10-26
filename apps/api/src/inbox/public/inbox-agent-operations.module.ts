import { Module } from "@nestjs/common";
import { InboxAgentWrites } from "../inbox-agent-operations.service";
import { InboxAgentOperations } from "./inbox-agent-operations";

@Module({ providers: [{ provide: InboxAgentOperations, useClass: InboxAgentWrites }], exports: [InboxAgentOperations] })
export class InboxAgentOperationsModule {}
