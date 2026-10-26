import { Module } from "@nestjs/common";
import { HomeContactWrites } from "../home-contact-commands.service";
import { HomeContactCommands } from "./home-contact-commands";

@Module({ providers: [{ provide: HomeContactCommands, useClass: HomeContactWrites }], exports: [HomeContactCommands] })
export class HomeContactCommandsModule {}
