import { Injectable } from "@nestjs/common";
import { isRegisteredPermission, type CommandDefinition } from "@orion/shared-types";

/**
 * Обработчик серверной команды. Получает уже проверенные `userId` и
 * `workspaceId`; членство и доступность модуля проверяет `CommandsService` до
 * вызова. Обработчик исполняет предметную операцию обычным сервисом (со своей
 * транзакцией), поэтому здесь нет `tx`: команда — это действие, а не часть
 * чужой транзакции.
 */
export interface CommandHandler {
  run(userId: string, workspaceId: string, args: unknown): Promise<unknown>;
}

export interface RegisteredCommand extends CommandDefinition {
  handler?: CommandHandler;
}

/**
 * Реестр команд (задание 10.3). Модули регистрируют команды в `onModuleInit`
 * из своей директории; сам реестр — отдельный маленький модуль
 * (`CommandRegistryModule`), чтобы не тянуть контроллеры и сервис вслед за
 * регистрацией.
 */
@Injectable()
export class CommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>();

  register(command: RegisteredCommand): void {
    // Опечатка в id разрешения иначе обнаружилась бы только отказом 403 в
    // рантайме — падаем при старте, как реестр провайдеров поиска.
    if (command.permission && !isRegisteredPermission(command.permission)) {
      throw new Error(`Команда «${command.id}»: разрешение «${command.permission}» не зарегистрировано`);
    }
    if (command.handler && command.run.kind !== "server") {
      throw new Error(`Команда «${command.id}»: обработчик допустим только для серверной команды`);
    }
    if (command.run.kind === "server" && !command.handler) {
      throw new Error(`Команда «${command.id}»: серверной команде нужен обработчик`);
    }
    if (this.commands.has(command.id)) {
      throw new Error(`Команда «${command.id}» уже зарегистрирована`);
    }
    this.commands.set(command.id, command);
  }

  get(id: string): RegisteredCommand | undefined {
    return this.commands.get(id);
  }

  /** Стабильный порядок: по модулю (`core` первым), затем по заголовку. */
  list(): RegisteredCommand[] {
    return [...this.commands.values()].sort((left, right) => {
      if (left.module !== right.module) return left.module === "core" ? -1 : right.module === "core" ? 1 : left.module.localeCompare(right.module, "en");
      return left.title.localeCompare(right.title, "ru");
    });
  }
}
