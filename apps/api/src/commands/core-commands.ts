import { Injectable, OnModuleInit } from "@nestjs/common";
import { CommandRegistry } from "./command.registry";

/**
 * Команды ядра: только инструкции интерфейсу. Серверные операции (например
 * создание таблицы) регистрирует владелец домена — `tables`/`TableCommands`.
 */
@Injectable()
export class CoreCommands implements OnModuleInit {
  constructor(private readonly registry: CommandRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      id: "core.open-command-palette",
      title: "Открыть палитру команд",
      module: "core",
      keywords: ["палитра", "команды", "поиск команд", "palette"],
      context: null,
      permission: "core.command.read",
      run: { kind: "ui", route: "palette:commands" }
    });
    this.registry.register({
      id: "core.open-global-search",
      title: "Найти во всём пространстве",
      module: "core",
      keywords: ["поиск", "найти", "search"],
      context: null,
      permission: "core.command.read",
      run: { kind: "ui", route: "palette:search" }
    });
    this.registry.register({
      id: "core.open-module-settings",
      title: "Модули пространства",
      module: "core",
      keywords: ["модули", "настройки", "settings", "modules"],
      context: null,
      permission: "core.command.read",
      run: { kind: "ui", route: "settings:modules" }
    });
  }
}
