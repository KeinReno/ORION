import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ModulesModule } from "../modules/modules.module";
import { PluginsController } from "./plugins.controller";
import { PluginsService } from "./plugins.service";

@Global()
@Module({
  imports: [WorkspacesModule, ModulesModule],
  controllers: [PluginsController],
  providers: [PluginsService],
  exports: [PluginsService]
})
export class PluginsModule {}
