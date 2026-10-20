import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LanModule } from "../lan/lan.module";
import { ExtensionsController } from "./extensions.controller";
import { ExtensionsService } from "./extensions.service";

/** Расширения из папки (ADR-0022, E2): обнаружение, подтверждение, отдача кода интерфейсу. */
@Module({
  imports: [AuthModule, LanModule],
  controllers: [ExtensionsController],
  providers: [ExtensionsService]
})
export class ExtensionsModule {}
