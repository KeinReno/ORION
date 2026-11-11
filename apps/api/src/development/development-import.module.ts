import { Module } from "@nestjs/common";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { TaskTraceReaderModule } from "../tasks/public/task-trace-reader.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { McpAgentToolsModule } from "../mcp/agent-tools.module";
import { DevelopmentImportController } from "./development-import.controller";
import { DevelopmentAgentController } from "./development-agent.controller";
import { DevelopmentArchitectController } from "./architect/development-architect.controller";
import { DevelopmentArchitectService } from "./architect/development-architect.service";
import { DevelopmentGitController } from "./git/development-git.controller";
import { DevelopmentGitService } from "./git/development-git.service";
import { DevelopmentTaskLinksController } from "./git/development-task-links.controller";
import { DevelopmentTaskLinksService } from "./git/development-task-links.service";

/**
 * Development: reviewed import каталога (ADR-0045) + Git Workspace, привязки коммитов и Architect
 * (задание 11). Один Nest-модуль на capability: доступ к репозиториям, карте и импорту идёт через
 * один `@RequireModule("orion-dev")`, данные проектов/задач остаются у их владельцев.
 */
@Module({
  imports: [TaskOperationsModule, TaskTraceReaderModule, WorkspacesModule, AgentCoreModule, McpAgentToolsModule],
  controllers: [
    DevelopmentImportController,
    DevelopmentGitController,
    DevelopmentTaskLinksController,
    DevelopmentArchitectController,
    DevelopmentAgentController
  ],
  providers: [DevelopmentGitService, DevelopmentTaskLinksService, DevelopmentArchitectService]
})
export class DevelopmentImportModule {}
