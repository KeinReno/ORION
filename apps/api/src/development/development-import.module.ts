import { Module } from "@nestjs/common";
import { DevelopmentImportController } from "./development-import.controller";

@Module({
  controllers: [DevelopmentImportController]
})
export class DevelopmentImportModule {}
