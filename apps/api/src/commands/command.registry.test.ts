import { describe, expect, it } from "vitest";
import { CommandRegistry, type RegisteredCommand } from "./command.registry";

const uiCommand = (id: string, module: RegisteredCommand["module"] = "core"): RegisteredCommand => ({
  id,
  title: id,
  module,
  keywords: [],
  context: null,
  permission: null,
  run: { kind: "ui", route: "panel:test" }
});

describe("CommandRegistry", () => {
  it("сортирует core первым и не даёт зарегистрировать команду дважды", () => {
    const registry = new CommandRegistry();
    registry.register(uiCommand("tasks.create", "tasks"));
    registry.register(uiCommand("core.open-tables"));
    expect(registry.list().map((command) => command.id)).toEqual(["core.open-tables", "tasks.create"]);
    expect(() => registry.register(uiCommand("core.open-tables"))).toThrow(/уже зарегистрирована/);
  });

  it("падает при неизвестном разрешении", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register({ ...uiCommand("core.bad"), permission: "core.nope.read" })).toThrow(/не зарегистрировано/);
  });

  it("требует обработчик у серверной команды и запрещает его у UI-команды", () => {
    const registry = new CommandRegistry();
    expect(() => registry.register({ ...uiCommand("core.no-handler"), run: { kind: "server", operation: "x" } })).toThrow(/нужен обработчик/);
    expect(() =>
      registry.register({
        ...uiCommand("core.handler-on-ui"),
        handler: { run: async () => null }
      })
    ).toThrow(/только для серверной команды/);
  });

  it("серверная команда получает пользователя и пространство", async () => {
    const registry = new CommandRegistry();
    let called: unknown = null;
    registry.register({
      ...uiCommand("core.create-table"),
      run: { kind: "server", operation: "tables.create" },
      handler: {
        run: async (userId, workspaceId, args) => {
          called = { userId, workspaceId, args };
          return { id: "table-1" };
        }
      }
    });
    const command = registry.get("core.create-table")!;
    expect(await command.handler!.run("u1", "w1", { name: "T" })).toEqual({ id: "table-1" });
    expect(called).toEqual({ userId: "u1", workspaceId: "w1", args: { name: "T" } });
  });
});
