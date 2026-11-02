import { Module } from "@nestjs/common";
import { DevelopmentImportModule } from "../../development/development-import.module";

/** Workbench contribution for the existing Development capability. */
@Module({ imports: [DevelopmentImportModule] })
export class OrionDevModule {}
