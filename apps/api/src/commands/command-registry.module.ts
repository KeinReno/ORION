import { Module } from "@nestjs/common";
import { CommandRegistry } from "./command.registry";

/** Только реестр: его импортируют и модули (чтобы зарегистрировать команды), и `CommandsModule` (чтобы отдать список). */
@Module({ providers: [CommandRegistry], exports: [CommandRegistry] })
export class CommandRegistryModule {}
