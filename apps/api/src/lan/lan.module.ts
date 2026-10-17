import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LanController, LoopbackOnlyGuard } from "./lan.controller";
import { LanService } from "./lan.service";

@Module({
  imports: [AuthModule],
  controllers: [LanController],
  providers: [LanService, LoopbackOnlyGuard],
  exports: [LanService]
})
export class LanModule {}
