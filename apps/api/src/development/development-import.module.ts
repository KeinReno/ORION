import { Module } from "@nestjs/common";
import { DevelopmentImportController } from "./development-import.controller";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";

@Module({
  imports: [TaskOperationsModule],
  controllers: [DevelopmentImportController]
})
export class DevelopmentImportModule {}
