import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CompassEngineService } from "./compass-engine.service";
import { MarketsController } from "./markets.controller";
import { MarketsService } from "./markets.service";

/** ORION «Рынки» — one controller/service pair. See MarketsService for the boundaries it keeps. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [MarketsController],
  providers: [MarketsService, CompassEngineService]
})
export class MarketsModule {}
