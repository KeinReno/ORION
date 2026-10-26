import { Module } from "@nestjs/common";
import { ListExpenseWrites } from "../list-expense-commands.service";
import { ListExpenseCommands } from "./list-expense-commands";

@Module({ providers: [{ provide: ListExpenseCommands, useClass: ListExpenseWrites }], exports: [ListExpenseCommands] })
export class ListExpenseCommandsModule {}
