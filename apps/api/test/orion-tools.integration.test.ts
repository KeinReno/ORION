import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { CommandRegistry } from "../src/commands/command.registry";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

/**
 * Задание 10: Orion Tables (формулы, CSV, ссылки), единый вход глобального
 * поиска (включая материал базы знаний и выключенный модуль) и реестр команд с
 * горячими клавишами. Тест идёт по HTTP против настоящей PostgreSQL: RLS,
 * миграции и триггер `searchVector` — часть проверки, а не моки.
 */
describe("Orion tools: tables, global search, commands", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `orion-tools-${runId}`;
  const term = `зебралис${runId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status, JSON.stringify(response.data)).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { ...response.data, workspaceId: workspaces.data[0]!.id };
  }

  it("считает sum-формулу на чтении и отклоняет неизвестную функцию при записи схемы", async () => {
    const session = await register("tables");
    const base = `/workspaces/${session.workspaceId}/tables`;
    const auth = { token: session.accessToken };
    const columns = [
      { id: "name", name: "Название", type: "text" },
      { id: "amount", name: "Сумма", type: "number" },
      { id: "total", name: "Итог", type: "formula", formula: "sum(amount)" }
    ];
    const created = await request<{ id: string }>(base, { method: "POST", ...auth, body: { name: "Бюджет", columns } });
    expect(created.status, JSON.stringify(created.data)).toBe(201);

    for (const [name, amount] of [["a", 10], ["b", 20]] as const) {
      const row = await request(`${base}/${created.data.id}/rows`, { method: "POST", ...auth, body: { values: { name, amount } } });
      expect(row.status, JSON.stringify(row.data)).toBe(201);
    }
    const read = await request<{ rows: Array<{ values: Record<string, unknown> }>; totals: Record<string, number | null>; definition: { rowCount: number } }>(
      `${base}/${created.data.id}`,
      { method: "GET", ...auth }
    );
    expect(read.status).toBe(200);
    expect(read.data.definition.rowCount).toBe(2);
    expect(read.data.totals.total).toBe(30);

    const bad = await request(`${base}/${created.data.id}`, {
      method: "PATCH",
      ...auth,
      body: { columns: [...columns.slice(0, 2), { id: "total", name: "Итог", type: "formula", formula: "median(amount)" }] }
    });
    expect(bad.status, JSON.stringify(bad.data)).toBe(422);
  });

  it("проверяет ссылку на задачу через контракт владельца", async () => {
    const session = await register("links");
    const base = `/workspaces/${session.workspaceId}`;
    const auth = { token: session.accessToken };
    const table = await request<{ id: string }>(`${base}/tables`, {
      method: "POST",
      ...auth,
      body: {
        name: "Связи",
        columns: [
          { id: "name", name: "Название", type: "text" },
          { id: "task", name: "Задача", type: "link", linkType: "task" }
        ]
      }
    });
    expect(table.status, JSON.stringify(table.data)).toBe(201);
    const missing = await request(`${base}/tables/${table.data.id}/rows`, {
      method: "POST",
      ...auth,
      body: { values: { name: "x", task: "00000000-0000-4000-8000-000000000000" } }
    });
    expect(missing.status, JSON.stringify(missing.data)).toBe(422);

    const task = await request<{ id: string }>(`${base}/tasks`, { method: "POST", ...auth, body: { title: "Задача для связи" } });
    expect(task.status).toBe(201);
    const linked = await request(`${base}/tables/${table.data.id}/rows`, {
      method: "POST",
      ...auth,
      body: { values: { name: "x", task: task.data.id } }
    });
    expect(linked.status, JSON.stringify(linked.data)).toBe(201);
  });

  it("импортирует CSV в новую таблицу с заявленными типами и экспортирует её", async () => {
    const session = await register("csv");
    const base = `/workspaces/${session.workspaceId}/tables`;
    const auth = { token: session.accessToken };
    const imported = await request<{ importedRows: number; definition: { id: string } }>(`${base}/import-csv`, {
      method: "POST",
      ...auth,
      body: {
        name: "Импорт",
        csv: "Название;Цена;Дата;Статус\nТовар;12,5;2026-11-01;новый\nВторой;7;2026-11-02;старый",
        columns: [
          { id: "name", name: "Название", type: "text", sourceHeader: "Название" },
          { id: "price", name: "Цена", type: "number", sourceHeader: "Цена" },
          { id: "day", name: "Дата", type: "date", sourceHeader: "Дата" },
          { id: "status", name: "Статус", type: "select", options: ["новый", "старый"], sourceHeader: "Статус" }
        ]
      }
    });
    expect(imported.status, JSON.stringify(imported.data)).toBe(201);
    expect(imported.data.importedRows).toBe(2);

    const read = await request<{ rows: Array<{ values: Record<string, unknown> }> }>(`${base}/${imported.data.definition.id}`, {
      method: "GET",
      ...auth
    });
    expect(read.data.rows[0]!.values).toEqual({ name: "Товар", price: 12.5, day: "2026-11-01", status: "новый" });

    const exported = await fetch(`${baseUrl}${base}/${imported.data.definition.id}/export.csv`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    const text = await exported.text();
    expect(text).toContain("Цена");
    expect(text).toContain("12.5");
  });

  it("глобальный поиск находит задачу, заметку и материал, а выключенный модуль не опрашивается", async () => {
    const session = await register("search");
    const base = `/workspaces/${session.workspaceId}`;
    const auth = { token: session.accessToken };
    const task = await request(`${base}/tasks`, { method: "POST", ...auth, body: { title: `Задача ${term}` } });
    const note = await request(`${base}/notes`, { method: "POST", ...auth, body: { title: `Заметка ${term}`, body: `Текст ${term}` } });
    const material = await request(`${base}/knowledge/items`, {
      method: "POST",
      ...auth,
      body: { title: `Материал ${term}`, body: `Содержание ${term}`, kind: "fact" }
    });
    expect(task.status).toBe(201);
    expect(note.status).toBe(201);
    expect(material.status, JSON.stringify(material.data)).toBe(201);

    const found = await request<{
      results: Array<{ type: string; id: string; title: string; module: string; moduleLabel: string; deepLink: { entityId: string; entityType: string } }>;
    }>(`/search?workspaceId=${session.workspaceId}&q=${term}`, { method: "GET", ...auth });
    expect(found.status, JSON.stringify(found.data)).toBe(200);
    expect(found.data.results.map((hit) => hit.type).sort()).toEqual(["knowledge_item", "note", "task"]);
    const materialHit = found.data.results.find((hit) => hit.type === "knowledge_item")!;
    expect(materialHit.module).toBe("knowledge");
    expect(materialHit.moduleLabel).toBe("База знаний");
    expect(materialHit.deepLink.entityType).toBe("knowledge_item");
    expect(materialHit.deepLink.entityId).toBe((material.data as { id: string }).id);

    // Выключенный модуль не должен отдавать свои результаты через общий вход.
    const off = await request(`${base}/modules/notes`, { method: "PATCH", ...auth, body: { enabled: false, confirm: true } });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    const afterOff = await request<{ results: Array<{ type: string }> }>(`/search?workspaceId=${session.workspaceId}&q=${term}`, {
      method: "GET",
      ...auth
    });
    expect(afterOff.data.results.map((hit) => hit.type).sort()).toEqual(["knowledge_item", "task"]);

    const typesFiltered = await request<{ results: Array<{ type: string }> }>(
      `/search?workspaceId=${session.workspaceId}&q=${term}&types=task`,
      { method: "GET", ...auth }
    );
    expect(typesFiltered.data.results.map((hit) => hit.type)).toEqual(["task"]);

    // Окно по updatedAt: записи сегодняшние, поэтому «до 2000 года» пусто.
    const oldWindow = await request<{ results: unknown[] }>(
      `/search?workspaceId=${session.workspaceId}&q=${term}&to=2000-01-01`,
      { method: "GET", ...auth }
    );
    expect(oldWindow.data.results).toEqual([]);
    const brokenDate = await request(`/search?workspaceId=${session.workspaceId}&q=${term}&from=not-a-date`, {
      method: "GET",
      ...auth
    });
    expect(brokenDate.status).toBe(400);
  });

  it("команды: выключенный модуль не отдаёт свои команды, серверная команда исполняется", async () => {
    const session = await register("commands");
    const auth = { token: session.accessToken };
    const list = await request<Array<{ id: string; run: { kind: string } }>>(`/commands?workspaceId=${session.workspaceId}`, {
      method: "GET",
      ...auth
    });
    expect(list.status).toBe(200);
    expect(list.data.map((command) => command.id)).toContain("core.create-table");

    const executed = await request<{ kind: string; result: { id: string; name: string } }>("/commands/core.create-table/execute", {
      method: "POST",
      ...auth,
      body: {
        workspaceId: session.workspaceId,
        args: { name: "Из команды", columns: [{ id: "name", name: "Название", type: "text" }] }
      }
    });
    expect(executed.status, JSON.stringify(executed.data)).toBe(201);
    expect(executed.data.kind).toBe("executed");
    expect(executed.data.result.name).toBe("Из команды");

    const scheduler = app.get(CommandRegistry);
    scheduler.register({
      id: "test.tasks-only",
      title: "Только для теста",
      module: "tasks",
      keywords: [],
      context: null,
      permission: null,
      run: { kind: "ui", route: "panel:tasks" }
    });
    const before = await request<Array<{ id: string }>>(`/commands?workspaceId=${session.workspaceId}`, { method: "GET", ...auth });
    expect(before.data.map((command) => command.id)).toContain("test.tasks-only");

    const off = await request(`/workspaces/${session.workspaceId}/modules/tasks`, {
      method: "PATCH",
      ...auth,
      body: { enabled: false, confirm: true }
    });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    const after = await request<Array<{ id: string }>>(`/commands?workspaceId=${session.workspaceId}`, { method: "GET", ...auth });
    expect(after.data.map((command) => command.id)).not.toContain("test.tasks-only");
    const hiddenExecute = await request(`/commands/test.tasks-only/execute`, {
      method: "POST",
      ...auth,
      body: { workspaceId: session.workspaceId }
    });
    expect(hiddenExecute.status).toBe(404);
  });

  it("горячие клавиши возвращают конфликт как предупреждение, а не отказ", async () => {
    const session = await register("keys");
    const base = `/workspaces/${session.workspaceId}/key-bindings`;
    const auth = { token: session.accessToken };
    const first = await request<{ binding: { id: string }; conflicts: unknown[] }>(base, {
      method: "POST",
      ...auth,
      body: { commandId: "core.open-tables", keys: "Ctrl+K" }
    });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data.conflicts).toHaveLength(0);

    const second = await request<{ binding: { id: string }; conflicts: Array<{ keys: string; bindingIds: string[] }> }>(base, {
      method: "POST",
      ...auth,
      body: { commandId: "core.open-global-search", keys: "ctrl+k", scope: "global" }
    });
    expect(second.status, JSON.stringify(second.data)).toBe(201);
    const conflict = second.data.conflicts.find((item) => item.keys === "ctrl+k");
    expect(conflict).toBeDefined();
    expect(conflict!.bindingIds).toHaveLength(2);

    const list = await request<{ bindings: unknown[]; conflicts: unknown[] }>(base, { method: "GET", ...auth });
    expect(list.data.bindings).toHaveLength(2);
    expect(list.data.conflicts).toHaveLength(1);

    const duplicate = await request(base, {
      method: "POST",
      ...auth,
      body: { commandId: "core.open-tables", keys: "Ctrl+J" }
    });
    expect(duplicate.status).toBe(409);

    const removed = await request(`${base}/${first.data.binding.id}`, { method: "DELETE", ...auth });
    expect(removed.status).toBe(204);
  });
});
