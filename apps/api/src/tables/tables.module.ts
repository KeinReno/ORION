import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommandRegistryModule } from "../commands/command-registry.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { TaskReferenceReaderModule } from "../tasks/public/task-reference-reader.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TableCommands } from "./tables.commands";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";

/**
 * Orion Tables (задание 10.1) — общий инструмент ядра, не предметный модуль.
 * Ссылки на задачи/проекты проверяются публичными контрактами владельцев;
 * `CommandRegistryModule` нужен только для регистрации серверной команды.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, TaskReferenceReaderModule, ProjectReferencesModule, CommandRegistryModule],
  controllers: [TablesController],
  providers: [TablesService, TableCommands]
})
export class TablesModule {}
