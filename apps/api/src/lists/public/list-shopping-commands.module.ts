import { Module } from "@nestjs/common";
import { ListShoppingWrites } from "../list-shopping-commands.service";
import { ListShoppingCommands } from "./list-shopping-commands";

@Module({ providers: [{ provide: ListShoppingCommands, useClass: ListShoppingWrites }], exports: [ListShoppingCommands] })
export class ListShoppingCommandsModule {}
