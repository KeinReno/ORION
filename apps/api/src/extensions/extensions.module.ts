import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LanModule } from "../lan/lan.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ExtensionDataController } from "./extension-data.controller";
import { ExtensionDataService } from "./extension-data.service";
import { ExtensionsController } from "./extensions.controller";
import { ExtensionsService } from "./extensions.service";

/** Расширения из папки (ADR-0022): обнаружение, подтверждение, отдача кода (E2); данные, секреты, сеть (E3). */
@Module({
  imports: [AuthModule, LanModule, WorkspacesModule],
  controllers: [ExtensionsController, ExtensionDataController],
  providers: [ExtensionsService, ExtensionDataService]
})
export class ExtensionsModule {}
