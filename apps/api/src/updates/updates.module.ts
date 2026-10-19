import { Module } from "@nestjs/common";
import { JsonBodyGuard, UpdatesController } from "./updates.controller";
import { UpdateService } from "./update.service";

/** Обновления программы с GitHub Releases (десктопная сборка). */
@Module({ controllers: [UpdatesController], providers: [UpdateService, JsonBodyGuard] })
export class UpdatesModule {}
