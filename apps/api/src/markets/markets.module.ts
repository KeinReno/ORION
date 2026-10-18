import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CompassBackupService } from "./compass-backup.service";
import { CompassEngineService } from "./compass-engine.service";
import { MarketsController } from "./markets.controller";
import { MarketsService } from "./markets.service";

/** ORION «Рынки» — one controller/service pair. See MarketsService for the boundaries it keeps. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [MarketsController],
  providers: [MarketsService, CompassEngineService, CompassBackupService],
  // Резервная копия `.orion` (модуль sync) включает данные Compass.
  exports: [CompassBackupService]
})
export class MarketsModule {}
