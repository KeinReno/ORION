import { Module } from "@nestjs/common";
import { AgentCoreModule } from "../ai/agent-core.module";
import { AgentToolRunner } from "./agent-tool-runner";

@Module({
  imports: [AgentCoreModule],
  providers: [AgentToolRunner],
  exports: [AgentToolRunner]
})
export class McpAgentToolsModule {}
