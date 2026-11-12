import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Tasks 2.0 (задание 02), критерии приёмки:
 * 1) рекуррентная задача создаёт РОВНО один следующий экземпляр, двойное
 *    завершение дублей не даёт; skip продолжает цепочку;
 * 2) bulk dryRun не меняет данные, confirm применяет, частичное без
 *    `allowPartial` — 409, отказы приходят с причинами;
 * 3) статусы: дефолтный набор, удаление занятого — только с подтверждением
 *    переноса.
 * Плюс пользовательские поля (включая поиск по значению) и плановые свойства.
 */
describe("Tasks 2.0", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `tasks20-${runId}`;

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

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  type TaskDto = {
    id: string;
    title: string;
    status: string;
    statusId: string | null;
    dueAt: string | null;
    revision: number;
    importance: number | null;
    urgency: number | null;
    complexity: string | null;
    archivedAt: string | null;
    dependencyIds: string[];
  };

  type RuleDto = { id: string; generatedCount: number; instances: Array<{ ordinal: number; taskId: string | null; status: string }> };

  it("materialises exactly one next instance and is idempotent on double completion", async () => {
    const alice = await register("recurrence");
    const base = `/workspaces/${alice.workspaceId}/tasks`;
    const created = await request<TaskDto>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Ежедневный отчёт", dueAt: "2026-12-01T09:00:00.000Z" }
    });
    expect(created.status).toBe(201);

    const rule = await request<RuleDto>(`${base}/${created.data.id}/recurrence`, {
      method: "PUT",
      token: alice.accessToken,
      body: { freq: "daily", interval: 1, ends: { mode: "count", count: 2 } }
    });
    expect(rule.status).toBe(200);
    expect(rule.data.generatedCount).toBe(1);
    expect(rule.data.instances.filter((instance) => instance.status === "scheduled")).toHaveLength(1);

    // Completing the template creates one next instance.
    const done = await request<TaskDto>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    expect(done.status).toBe(200);
    let list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data).toHaveLength(2);
    const next = list.data.find((task) => task.id !== created.data.id)!;
    expect(next.dueAt).toBe("2026-12-02T09:00:00.000Z");

    // Double completion must not create a second copy.
    const again = await request<TaskDto>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    expect(again.status).toBe(200);
    list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data).toHaveLength(2);

    // Count = 2 means the next completion ends the series (no third instance).
    await request<TaskDto>(`${base}/${next.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data).toHaveLength(2);
  });

  it("skip removes a future instance but keeps the chain alive", async () => {
    const alice = await register("skip");
    const base = `/workspaces/${alice.workspaceId}/tasks`;
    const template = await request<TaskDto>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Полив", dueAt: "2026-12-05T09:00:00.000Z" }
    });
    await request<RuleDto>(`${base}/${template.data.id}/recurrence`, {
      method: "PUT",
      token: alice.accessToken,
      body: { freq: "daily", interval: 1, ends: { mode: "never" } }
    });
    await request<TaskDto>(`${base}/${template.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    let list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    const second = list.data.find((task) => task.id !== template.data.id)!;
    expect(second.dueAt).toBe("2026-12-06T09:00:00.000Z");

    const skipped = await request<{ nextTaskId: string | null }>(`${base}/${second.id}/recurrence/skip`, {
      method: "POST",
      token: alice.accessToken
    });
    expect(skipped.status).toBe(201);
    expect(skipped.data.nextTaskId).toBeTruthy();
    list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.map((task) => task.id)).not.toContain(second.id);
    const third = list.data.find((task) => task.id === skipped.data.nextTaskId)!;
    expect(third.dueAt).toBe("2026-12-07T09:00:00.000Z");
    // Skipped history is preserved on the rule.
    const rule = await request<RuleDto>(`${base}/${template.data.id}/recurrence`, { method: "GET", token: alice.accessToken });
    expect(rule.data.instances.some((instance) => instance.status === "skipped" && instance.taskId === null)).toBe(true);
  });

  it("bulk dryRun changes nothing, partial application is rejected without allowPartial and explains refusals", async () => {
    const alice = await register("bulk");
    const base = `/workspaces/${alice.workspaceId}/tasks`;
    const make = async (title: string, extra: Record<string, unknown> = {}) => {
      const response = await request<TaskDto>(base, { method: "POST", token: alice.accessToken, body: { title, ...extra } });
      expect(response.status).toBe(201);
      return response.data;
    };
    const dependency = await make("Зависимость");
    const blocked = await make("Заблокированная", { dependencyIds: [dependency.id] });
    const archived = await make("В архиве");
    await request<TaskDto>(`${base}/${archived.id}`, { method: "PATCH", token: alice.accessToken, body: { archived: true } });

    const bulk = (body: unknown) => request<{
      dryRun: boolean;
      applied: boolean;
      items: Array<{ taskId: string; ok: boolean; reason: string | null }>;
      summary: { requested: number; ok: number; failed: number };
    }>(`${base}/bulk`, { method: "POST", token: alice.accessToken, body });

    const dry = await bulk({ taskIds: [dependency.id, blocked.id, archived.id, "missing"], operation: { type: "complete" }, dryRun: true });
    expect(dry.status).toBe(201);
    expect(dry.data.dryRun).toBe(true);
    expect(dry.data.applied).toBe(false);
    expect(dry.data.summary.requested).toBe(4);
    expect(dry.data.items.find((entry) => entry.taskId === dependency.id)).toMatchObject({ ok: true });
    expect(dry.data.items.find((entry) => entry.taskId === blocked.id)).toMatchObject({ ok: false, reason: "blocked" });
    expect(dry.data.items.find((entry) => entry.taskId === archived.id)).toMatchObject({ ok: false, reason: "archived" });
    expect(dry.data.items.find((entry) => entry.taskId === "missing")).toMatchObject({ ok: false, reason: "not_found" });
    let list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.find((task) => task.id === dependency.id)?.status).toBe("todo");

    // Partial application without allowPartial is refused and writes nothing.
    const refused = await bulk({ taskIds: [dependency.id, blocked.id], operation: { type: "complete" }, confirm: true });
    expect(refused.status).toBe(409);
    expect((refused.data as unknown as { code: string }).code).toBe("bulk_partial_not_allowed");
    list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.find((task) => task.id === dependency.id)?.status).toBe("todo");

    // Explicit allowPartial applies the eligible task only.
    const applied = await bulk({ taskIds: [dependency.id, blocked.id], operation: { type: "complete" }, confirm: true, allowPartial: true });
    expect(applied.status).toBe(201);
    expect(applied.data.applied).toBe(true);
    list = await request<TaskDto[]>(base, { method: "GET", token: alice.accessToken });
    expect(list.data.find((task) => task.id === dependency.id)?.status).toBe("done");
    expect(list.data.find((task) => task.id === blocked.id)?.status).toBe("todo");
    expect(applied.data.items.find((entry) => entry.taskId === blocked.id)?.reason).toBe("blocked");
  });

  it("custom statuses require a confirmed reassignment before deletion", async () => {
    const alice = await register("statuses");
    const base = `/workspaces/${alice.workspaceId}`;
    const defaults = await request<Array<{ id: string; systemKey: string | null; isDefault: boolean; category: string }>>(
      `${base}/task-statuses`,
      { method: "GET", token: alice.accessToken }
    );
    expect(defaults.status).toBe(200);
    expect(defaults.data).toHaveLength(5);
    expect(defaults.data.find((status) => status.isDefault)?.systemKey).toBe("todo");
    const fallback = defaults.data.find((status) => status.isDefault)!;

    const custom = await request<{ id: string }>(`${base}/task-statuses`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Ждём ответа", category: "open", color: "violet" }
    });
    expect(custom.status).toBe(201);

    const task = await request<TaskDto>(`${base}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Письмо" } });
    const moved = await request<TaskDto>(`${base}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { statusId: custom.data.id }
    });
    expect(moved.status).toBe(200);
    expect(moved.data.statusId).toBe(custom.data.id);
    expect(moved.data.status).toBe("todo");

    const refused = await request<{ code: string; taskCount: number; reassignToId: string }>(
      `${base}/task-statuses/${custom.data.id}`,
      { method: "DELETE", token: alice.accessToken }
    );
    expect(refused.status).toBe(409);
    expect(refused.data.code).toBe("task_status_in_use");
    expect(refused.data.taskCount).toBe(1);
    expect(refused.data.reassignToId).toBe(fallback.id);

    const deleted = await request(`${base}/task-statuses/${custom.data.id}?confirm=true`, { method: "DELETE", token: alice.accessToken });
    expect(deleted.status).toBe(200);
    const after = await request<TaskDto>(`${base}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { title: "Письмо" } });
    expect(after.status).toBe(200);
    const list = await request<TaskDto[]>(`${base}/tasks`, { method: "GET", token: alice.accessToken });
    expect(list.data.find((entry) => entry.id === task.data.id)?.statusId).toBe(fallback.id);
  });

  it("custom fields validate values and are searchable; planning properties are independent", async () => {
    const alice = await register("fields");
    const base = `/workspaces/${alice.workspaceId}`;
    const field = await request<{ id: string }>(`${base}/task-fields`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Промокод", type: "text" }
    });
    expect(field.status).toBe(201);

    const task = await request<TaskDto>(`${base}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Заказ" } });
    const invalid = await request(`${base}/task-values/${task.data.id}`, {
      method: "PUT",
      token: alice.accessToken,
      body: { values: [{ fieldId: field.data.id, value: 42 }] }
    });
    expect(invalid.status).toBe(400);

    const values = await request<Record<string, string>>(`${base}/task-values/${task.data.id}`, {
      method: "PUT",
      token: alice.accessToken,
      body: { values: [{ fieldId: field.data.id, value: "уникум" }] }
    });
    expect(values.status).toBe(200);
    expect(values.data[field.data.id]).toBe("уникум");

    const found = await request<TaskDto[]>(`${base}/tasks?search=${encodeURIComponent("уникум")}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(found.status).toBe(200);
    expect(found.data.map((entry) => entry.id)).toContain(task.data.id);

    const planned = await request<TaskDto>(`${base}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { importance: 3, urgency: 1, complexity: "high" }
    });
    expect(planned.status).toBe(200);
    expect(planned.data).toMatchObject({ importance: 3, urgency: 1, complexity: "high" });
    const urgencyOnly = await request<TaskDto>(`${base}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { urgency: 2 }
    });
    expect(urgencyOnly.data).toMatchObject({ importance: 3, urgency: 2, complexity: "high" });
  });
});
