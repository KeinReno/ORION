import { Global, Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ModuleEnabledGuard } from "./module-enabled.guard";
import { ModulesController } from "./modules.controller";
import { ModulesService } from "./modules.service";

@Global()
@Module({
  imports: [WorkspacesModule],
  controllers: [ModulesController],
  providers: [ModulesService, ModuleEnabledGuard],
  exports: [ModulesService, ModuleEnabledGuard]
})
export class ModulesModule {}
