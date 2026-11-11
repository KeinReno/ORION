import { Injectable, NotFoundException } from "@nestjs/common";
import type { CommandDefinition, CommandExecutionResult } from "@orion/shared-types";
import type { OrionModuleId } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CommandRegistry } from "./command.registry";

/**
 * Список и исполнение команд (задание 10.3).
 *
 * Видимость команды решает `ModulesService.accessibleSetTx` — тот же чекпойнт,
 * что у `@RequireModule`: выключенный модуль не показывает свои команды, а
 * ограниченный (restricted) — не показывает их обычному участнику. Ядро
 * (`core`) видно всегда. Членство проверяется первым, как в любом workspace-пути.
 */
@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly registry: CommandRegistry
  ) {}

  async list(userId: string, workspaceId: string): Promise<CommandDefinition[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      return this.registry
        .list()
        .filter((command) => isVisible(command.module, accessible))
        .map(toDefinition);
    });
  }

  async execute(
    userId: string,
    workspaceId: string,
    commandId: string,
    args: unknown
  ): Promise<CommandExecutionResult> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const command = this.registry.get(commandId);
      // Выключенный модуль отвечает так же, как неизвестная команда: наличие
      // чужой/скрытой команды не должно утекать через разницу кодов.
      if (!command || !isVisible(command.module, accessible)) throw new NotFoundException("Команда не найдена");
    });

    const command = this.registry.get(commandId)!;
    if (command.run.kind === "ui") {
      return { kind: "instruction", commandId, route: command.run.route! };
    }
    // Обработчик есть у каждой серверной команды — это проверено при регистрации.
    const result = await command.handler!.run(userId, workspaceId, args);
    return { kind: "executed", commandId, result };
  }
}

function isVisible(module: CommandDefinition["module"], accessible: ReadonlySet<OrionModuleId>): boolean {
  return module === "core" || accessible.has(module);
}

/** Наружу — контракт без обработчика: клиенту нечего делать с серверной функцией. */
function toDefinition(command: CommandDefinition): CommandDefinition {
  return {
    id: command.id,
    title: command.title,
    module: command.module,
    keywords: [...command.keywords],
    context: command.context,
    permission: command.permission,
    run: { ...command.run }
  };
}
