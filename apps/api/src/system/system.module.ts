import { Module } from "@nestjs/common";
import { ComponentDataService } from "./component-data.service";
import { SystemController } from "./system.controller";

@Module({ controllers: [SystemController], providers: [ComponentDataService] })
export class SystemModule {}
