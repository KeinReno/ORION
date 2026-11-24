import { Module } from "@nestjs/common";
import { AgentCoreModule } from "../ai/agent-core.module";
import { AgentChangeRunner } from "./agent-change-runner";
import { AgentToolRunner } from "./agent-tool-runner";

@Module({
  imports: [AgentCoreModule],
  providers: [AgentToolRunner, AgentChangeRunner],
  exports: [AgentToolRunner, AgentChangeRunner]
})
export class McpAgentToolsModule {}
