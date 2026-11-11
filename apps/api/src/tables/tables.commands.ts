import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { createTableInputSchema } from "@orion/shared-types";
import { CommandRegistry } from "../commands/command.registry";
import { TablesService } from "./tables.service";

/**
 * Команды таблиц: серверная операция создания и UI-инструкция открыть панель.
 * Регистрируются владельцем (модуль `tables`), поэтому выключение любого
 * пользовательского модуля их не затрагивает — это общий инструмент.
 */
@Injectable()
export class TableCommands implements OnModuleInit {
  constructor(
    private readonly registry: CommandRegistry,
    private readonly tables: TablesService
  ) {}

  onModuleInit(): void {
    this.registry.register({
      id: "core.create-table",
      title: "Создать таблицу",
      module: "core",
      keywords: ["таблица", "tables", "создать"],
      context: null,
      permission: "core.table.create",
      run: { kind: "server", operation: "tables.create" },
      handler: {
        run: async (userId, workspaceId, args) => {
          const parsed = createTableInputSchema.safeParse(args);
          if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
          return this.tables.create(userId, workspaceId, parsed.data);
        }
      }
    });
    this.registry.register({
      id: "core.open-tables",
      title: "Открыть таблицы",
      module: "core",
      keywords: ["таблицы", "tables"],
      context: null,
      permission: "core.table.read",
      run: { kind: "ui", route: "panel:tables" }
    });
  }
}
