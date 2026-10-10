import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ModulesModule } from "../modules/modules.module";
import { PluginsController } from "./plugins.controller";
import { PluginEnabledGuard } from "./plugin-enabled.guard";
import { PluginsService } from "./plugins.service";

@Global()
@Module({
  imports: [WorkspacesModule, ModulesModule],
  controllers: [PluginsController],
  providers: [PluginsService, PluginEnabledGuard],
  exports: [PluginsService, PluginEnabledGuard]
})
export class PluginsModule {}
