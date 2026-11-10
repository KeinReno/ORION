import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentContentReaderModule } from "../documents/public/document-content-reader.module";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { SendController } from "./send.controller";
import { SendService } from "./send.service";

@Module({
  imports: [AuthModule, DocumentContentReaderModule],
  controllers: [SendController],
  providers: [SendService, LoopbackOnlyGuard]
})
export class SendModule {}
