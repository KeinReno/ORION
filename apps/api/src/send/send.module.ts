import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentsCoreModule } from "../documents/documents-core.module";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { SendController } from "./send.controller";
import { SendService } from "./send.service";

@Module({
  imports: [AuthModule, DocumentsCoreModule],
  controllers: [SendController],
  providers: [SendService, LoopbackOnlyGuard]
})
export class SendModule {}
