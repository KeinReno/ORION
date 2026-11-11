import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CommandRegistryModule } from "./command-registry.module";
import { CommandsController } from "./commands.controller";
import { CommandsService } from "./commands.service";
import { CoreCommands } from "./core-commands";
import { KeyBindingsController } from "./key-bindings.controller";
import { KeyBindingsService } from "./key-bindings.service";

/**
 * Общие инструменты (задание 10.3): реестр команд, единый вход и личные
 * горячие клавиши. Не предметный модуль — выключать нечего, права проверяются
 * `@RequirePermission` и членством.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, CommandRegistryModule],
  controllers: [CommandsController, KeyBindingsController],
  providers: [CommandsService, KeyBindingsService, CoreCommands]
})
export class CommandsModule {}
