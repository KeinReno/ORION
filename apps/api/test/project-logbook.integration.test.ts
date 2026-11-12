import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { DomainEventBus } from "../src/domain-events/domain-event-bus";
import { DomainEventDispatcherService } from "../src/domain-events/domain-event-dispatcher.service";

describe("Project logbook and directed project relations", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: DomainEventBus;
  let dispatcher: DomainEventDispatcherService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `project-logbook-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    events = app.get(DomainEventBus);
    dispatcher = app.get(DomainEventDispatcherService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
      if (!users.length) return;
      const userIds = users.map((user) => user.id);
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.workspace.deleteMany({ where: { id: { in: [...new Set(memberships.map((row) => row.workspaceId))] } } });
    });
    await app?.close();
  });

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST", body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function project(workspaceId: string, token: string, name: string, parentId?: string): Promise<string> {
    const response = await request<{ id: string }>(`/workspaces/${workspaceId}/projects`, { method: "POST", token, body: { name, parentId } });
    expect(response.status).toBe(201);
    return response.data.id;
  }

  it("keeps a task as a live reference and stores the comment only on the journal link", async () => {
    const alice = await register("entries");
    const qa2 = await project(alice.workspaceId, alice.accessToken, "QA-v2");
    const qa3 = await project(alice.workspaceId, alice.accessToken, "QA-v3");
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: alice.workspaceId, projectId: qa2, title: "Проверить восстановление", description: "Исходное описание" } }));
    const endpoint = `/workspaces/${alice.workspaceId}/projects/${qa3}/logbook`;

    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { kind: "decision", text: "spoof", authorId: "spoof", rationale: "x" } })).status).toBe(400);
    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { type: "decision", text: "Без обоснования" } })).status).toBe(422);
    const created = await request<{ id: string; authorId: string; type: string; kind: string; source: string; editable: boolean; tasks: Array<{ id: string; projectName: string; comment: string }> }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "decision", text: "Берём проверку в текущий цикл", rationale: "Иначе релиз не проверить на чистом профиле", tasks: [{ taskId: task.id, comment: "Нужна проверка на чистом профиле" }] }
    });
    expect(created.status).toBe(201);
    expect(created.data.authorId).toBe(alice.user.id);
    expect(created.data).toMatchObject({ type: "decision", kind: "decision", source: "manual", editable: true });
    expect(created.data.tasks).toEqual([{ id: task.id, title: task.title, status: task.status, projectId: qa2, projectName: "QA-v2", comment: "Нужна проверка на чистом профиле", url: null }]);

    const after = await prisma.asSystem((tx) => tx.task.findUniqueOrThrow({ where: { id: task.id } }));
    expect(after).toMatchObject({ title: "Проверить восстановление", description: "Исходное описание", projectId: qa2 });
    expect((await request<Array<{ id: string }>>(endpoint, { method: "GET", token: alice.accessToken })).data.map((row) => row.id)).toContain(created.data.id);
    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { kind: "observation", text: "x", tasks: [{ taskId: task.id }, { taskId: task.id }] } })).status).toBe(400);
  });

  it("stores directed relationships once and exposes them from both project pages", async () => {
    const alice = await register("relations");
    const qa2 = await project(alice.workspaceId, alice.accessToken, "QA-v2");
    const qa3 = await project(alice.workspaceId, alice.accessToken, "QA-v3");
    const from = `/workspaces/${alice.workspaceId}/projects/${qa3}/relations`;
    const to = `/workspaces/${alice.workspaceId}/projects/${qa2}/relations`;
    const created = await request<{ id: string; type: string; fromProjectName: string; toProjectName: string }>(from, {
      method: "POST", token: alice.accessToken, body: { type: "continues", toProjectId: qa2 }
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ type: "continues", fromProjectName: "QA-v3", toProjectName: "QA-v2" });
    expect((await request<Array<{ id: string }>>(to, { method: "GET", token: alice.accessToken })).data.map((item) => item.id)).toContain(created.data.id);
    const related = await request<{ id: string }>(from, { method: "POST", token: alice.accessToken, body: { type: "related", toProjectId: qa2 } });
    expect(related.status).toBe(201);
    expect((await request(to, { method: "POST", token: alice.accessToken, body: { type: "related", toProjectId: qa3 } })).status).toBe(409);
    expect((await request(`${to}/${related.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(from, { method: "POST", token: alice.accessToken, body: { type: "continues", toProjectId: qa2 } })).status).toBe(409);
    expect((await request(`${from}/${created.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(from, { method: "GET", token: alice.accessToken })).data).toEqual([]);
  });

  it("rejects task and project references from another workspace", async () => {
    const alice = await register("source");
    const bob = await register("target");
    const ownProject = await project(alice.workspaceId, alice.accessToken, "Свой проект");
    const foreignProject = await project(bob.workspaceId, bob.accessToken, "Чужой проект");
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: bob.workspaceId, projectId: foreignProject, title: "Закрытая задача" } }));
    expect((await request(`/workspaces/${alice.workspaceId}/projects/${ownProject}/logbook`, { method: "POST", token: alice.accessToken, body: { kind: "observation", text: "ссылка", tasks: [{ taskId: task.id }] } })).status).toBe(404);
    expect((await request(`/workspaces/${alice.workspaceId}/projects/${ownProject}/relations`, { method: "POST", token: alice.accessToken, body: { type: "depends_on", toProjectId: foreignProject } })).status).toBe(404);
  });

  it("enforces per-type fields and returns a field map on 422", async () => {
    const alice = await register("typed");
    const projectId = await project(alice.workspaceId, alice.accessToken, "Typed");
    const endpoint = `/workspaces/${alice.workspaceId}/projects/${projectId}/logbook`;

    const badDecision = await request<{ code: string; errors: Record<string, string> }>(endpoint, {
      method: "POST", token: alice.accessToken, body: { type: "decision", text: "Без обоснования" }
    });
    expect(badDecision.status).toBe(422);
    expect(badDecision.data.code).toBe("logbook_entry_invalid");
    expect(badDecision.data.errors.rationale).toBeTruthy();

    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { type: "incident", text: "Без severity" } })).status).toBe(422);
    expect((await request(endpoint, { method: "POST", token: alice.accessToken, body: { type: "observation", text: "Лишнее", severity: "high" } })).status).toBe(422);

    const hypothesis = await request<{ id: string }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "hypothesis", text: "Проверка ускорит поиск", verificationDue: "2020-01-01T00:00:00.000Z" }
    });
    expect(hypothesis.status).toBe(201);
    const decision = await request<{ id: string }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "decision", text: "Кэшируем", rationale: "Меньше запросов", alternatives: [{ option: "Индекс", whyNot: "Дороже" }] }
    });
    expect(decision.status).toBe(201);
    const result = await request<{ id: string; confirmsEntryId: string; verdict: string }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "result", text: "Стало быстрее", confirmsEntryId: hypothesis.data.id, verdict: "confirms" }
    });
    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ confirmsEntryId: hypothesis.data.id, verdict: "confirms" });

    const foreignResult = await request<{ errors: Record<string, string> }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "result", text: "Чужое", confirmsEntryId: randomUUID() }
    });
    expect(foreignResult.status).toBe(422);
    expect(foreignResult.data.errors.confirmsEntryId).toBeTruthy();

    const incident = await request<{ id: string; severity: string; editable: boolean }>(endpoint, {
      method: "POST", token: alice.accessToken,
      body: { type: "incident", text: "Прод упал", severity: "high", resolution: "Перезапустили" }
    });
    expect(incident.status).toBe(201);
    expect(incident.data).toMatchObject({ severity: "high", editable: true });

    // Ручную запись автор правит; поля перепроверяются на merged-состоянии.
    const edited = await request<{ text: string; rationale: string }>(`${endpoint}/${decision.data.id}`, {
      method: "PATCH", token: alice.accessToken, body: { text: "Кэшируем ответы", rationale: "Меньше запросов к БД" }
    });
    expect(edited.status).toBe(200);
    expect(edited.data).toMatchObject({ text: "Кэшируем ответы", rationale: "Меньше запросов к БД" });
    expect((await request(`${endpoint}/${decision.data.id}`, { method: "PATCH", token: alice.accessToken, body: { rationale: "" } })).status).toBe(422);
  });

  it("filters by type, author, period and linked tasks; includes child projects in the summary", async () => {
    const alice = await register("filters");
    const parent = await project(alice.workspaceId, alice.accessToken, "Родитель");
    const child = await project(alice.workspaceId, alice.accessToken, "Ребёнок", parent);
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: alice.workspaceId, projectId: parent, title: "Связанная" } }));
    const endpoints = {
      parent: `/workspaces/${alice.workspaceId}/projects/${parent}/logbook`,
      child: `/workspaces/${alice.workspaceId}/projects/${child}/logbook`,
      workspace: `/workspaces/${alice.workspaceId}/project-log`
    };

    const observation = await request<{ id: string }>(endpoints.parent, {
      method: "POST", token: alice.accessToken, body: { type: "observation", text: "Наблюдение", tasks: [{ taskId: task.id }] }
    });
    expect(observation.status).toBe(201);
    const hypothesis = await request<{ id: string }>(endpoints.parent, {
      method: "POST", token: alice.accessToken, body: { type: "hypothesis", text: "Старая гипотеза", verificationDue: "2020-01-01T00:00:00.000Z" }
    });
    expect(hypothesis.status).toBe(201);
    expect((await request(endpoints.parent, { method: "POST", token: alice.accessToken, body: { type: "incident", text: "Открытый инцидент", severity: "low" } })).status).toBe(201);
    const parentDecision = await request<{ id: string }>(endpoints.parent, {
      method: "POST", token: alice.accessToken, body: { type: "decision", text: "Решение без результата", rationale: "Пока так" }
    });
    expect(parentDecision.status).toBe(201);
    const unconfirmed = await request<{ id: string }>(endpoints.parent, {
      method: "POST", token: alice.accessToken, body: { type: "decision", text: "Без результата", rationale: "Пока не проверено" }
    });
    expect(unconfirmed.status).toBe(201);
    expect((await request(endpoints.parent, { method: "POST", token: alice.accessToken, body: { type: "result", text: "Подтверждение", confirmsEntryId: parentDecision.data.id, verdict: "confirms" } })).status).toBe(201);
    const childEntry = await request<{ id: string }>(endpoints.child, {
      method: "POST", token: alice.accessToken, body: { type: "change", text: "Ручное изменение" }
    });
    expect(childEntry.status).toBe(201);

    const typed = await request<Array<{ id: string }>>(`${endpoints.parent}?type=decision`, { method: "GET", token: alice.accessToken });
    expect(typed.data).toHaveLength(2);
    const byAuthor = await request<Array<{ authorId: string }>>(`${endpoints.parent}?authorId=${alice.user.id}`, { method: "GET", token: alice.accessToken });
    expect(byAuthor.data.every((row) => row.authorId === alice.user.id)).toBe(true);
    const withTasks = await request<Array<{ id: string }>>(`${endpoints.parent}?hasTasks=true`, { method: "GET", token: alice.accessToken });
    expect(withTasks.data.map((row) => row.id)).toEqual([observation.data.id]);
    const future = await request<Array<{ id: string }>>(`${endpoints.parent}?from=2999-01-01T00:00:00.000Z`, { method: "GET", token: alice.accessToken });
    expect(future.data).toEqual([]);

    // Дочерний проект попадает в выборку родителя (recursive CTE) и наоборот — нет.
    const parentScope = await request<Array<{ projectId: string }>>(endpoints.parent, { method: "GET", token: alice.accessToken });
    expect(parentScope.data.some((row) => row.projectId === child)).toBe(true);
    const childScope = await request<Array<{ projectId: string }>>(endpoints.child, { method: "GET", token: alice.accessToken });
    expect(childScope.data.map((row) => row.projectId)).toEqual([child]);

    const workspaceByProject = await request<Array<{ id: string }>>(`${endpoints.workspace}?projectId=${parent}`, { method: "GET", token: alice.accessToken });
    expect(workspaceByProject.data.some((row) => row.id === childEntry.data.id)).toBe(true);

    const summary = await request<{
      counts: Record<string, number>; total: number;
      overdueHypotheses: Array<{ id: string }>; incidentsWithoutResolution: Array<{ id: string }>; decisionsWithoutResults: Array<{ id: string }>;
    }>(`${endpoints.parent}/summary`, { method: "GET", token: alice.accessToken });
    expect(summary.status).toBe(200);
    expect(summary.data.counts).toMatchObject({ observation: 1, hypothesis: 1, incident: 1, decision: 2, result: 1, change: 1 });
    expect(summary.data.total).toBe(7);
    expect(summary.data.overdueHypotheses.map((row) => row.id)).toEqual([hypothesis.data.id]);
    expect(summary.data.incidentsWithoutResolution).toHaveLength(1);
    expect(summary.data.decisionsWithoutResults.map((row) => row.id)).toEqual([unconfirmed.data.id]);
  });

  it("aggregates attached materials through EntityLinks and cleans the links with the entry", async () => {
    const alice = await register("related");
    const projectId = await project(alice.workspaceId, alice.accessToken, "Материалы");
    const entry = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/projects/${projectId}/logbook`, {
      method: "POST", token: alice.accessToken, body: { type: "observation", text: "Нужны материалы" }
    });
    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST", token: alice.accessToken, body: { title: "Материал журнала", body: "Текст" }
    });
    expect(note.status).toBe(201);
    const link = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST", token: alice.accessToken,
      body: { sourceType: "project_log_entry", sourceId: entry.data.id, targetType: "note", targetId: note.data.id, kind: "related_to" }
    });
    expect(link.status).toBe(201);

    const related = await request<{ entryId: string; links: Array<{ id: string; sourceType: string; sourceId: string; targetType: string; targetId: string; title: string }> }>(
      `/workspaces/${alice.workspaceId}/project-log/${entry.data.id}/related`, { method: "GET", token: alice.accessToken }
    );
    expect(related.status).toBe(200);
    expect(related.data).toMatchObject({ entryId: entry.data.id });
    expect(related.data.links).toHaveLength(1);
    const linkRow = related.data.links[0]!;
    expect(linkRow.id).toBe(link.data.id);
    // Связь хранится в каноническом направлении symmetric-типа; запись журнала —
    // один из концов, вторая сторона — прикреплённая заметка.
    expect([linkRow.sourceType, linkRow.targetType]).toContain("project_log_entry");
    expect([linkRow.sourceId, linkRow.targetId]).toContain(entry.data.id);
    expect([linkRow.sourceType, linkRow.targetType]).toContain("note");
    expect([linkRow.sourceId, linkRow.targetId]).toContain(note.data.id);

    expect((await request(`/workspaces/${alice.workspaceId}/projects/${projectId}/logbook/${entry.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    const left = await prisma.asSystem((tx) => tx.entityLink.count({ where: { workspaceId: alice.workspaceId, id: link.data.id } }));
    expect(left).toBe(0);
  });

  it("creates one read-only auto entry per event and one per bulk operation", async () => {
    const alice = await register("auto");
    const projectId = await project(alice.workspaceId, alice.accessToken, "Автожурнал");
    const endpoint = `/workspaces/${alice.workspaceId}/projects/${projectId}/logbook`;

    // Реальный издатель: смена статуса проекта через API.
    expect((await request(`/workspaces/${alice.workspaceId}/projects/${projectId}`, { method: "PATCH", token: alice.accessToken, body: { status: "completed" } })).status).toBe(200);
    await dispatcher.runOnce();

    const milestone = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/milestones`, {
      method: "POST", token: alice.accessToken, body: { projectId, title: "Релиз" }
    });
    expect(milestone.status).toBe(201);
    expect((await request(`/workspaces/${alice.workspaceId}/milestones/${milestone.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } })).status).toBe(200);
    await dispatcher.runOnce();

    const afterEvents = await request<Array<{ id: string; type: string; source: string; sourceEventType: string; text: string; editable: boolean }>>(endpoint, { method: "GET", token: alice.accessToken });
    const statusEntry = afterEvents.data.find((row) => row.sourceEventType === "projects.project.status_changed");
    expect(statusEntry).toMatchObject({ type: "change", source: "event", editable: false });
    expect(afterEvents.data.some((row) => row.sourceEventType === "projects.milestone.completed" && row.text.includes("Релиз"))).toBe(true);

    // Read-only: автозапись нельзя ни править, ни удалить.
    expect((await request(`${endpoint}/${statusEntry!.id}`, { method: "PATCH", token: alice.accessToken, body: { text: "переписать" } })).status).toBe(409);
    expect((await request(`${endpoint}/${statusEntry!.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(409);

    // Назначение исполнителя задачи — ещё одно событие → запись журнала.
    const task = await prisma.asSystem((tx) => tx.task.create({ data: { workspaceId: alice.workspaceId, projectId, title: "Назначенная" } }));
    await prisma.asSystem((tx) => events.publishTx(tx, {
      workspaceId: alice.workspaceId, actorId: alice.user.id, type: "tasks.task.assigned",
      payload: { id: task.id, projectId, assigneeId: alice.user.id, previousAssigneeId: null }
    }));
    await dispatcher.runOnce();
    const afterAssign = await request<Array<{ text: string }>>(endpoint, { method: "GET", token: alice.accessToken });
    expect(afterAssign.data.some((row) => row.text.includes("Назначенная"))).toBe(true);

    // Bulk: два события с общим bulkId → ровно одна запись.
    await prisma.asSystem(async (tx) => {
      const bulkId = randomUUID();
      await events.publishTx(tx, {
        workspaceId: alice.workspaceId, actorId: alice.user.id, type: "projects.project.status_changed",
        payload: { id: projectId, from: "completed", to: "on_hold", bulkId, bulkLabel: "Групповая смена статуса" }
      });
      await events.publishTx(tx, {
        workspaceId: alice.workspaceId, actorId: alice.user.id, type: "projects.project.status_changed",
        payload: { id: projectId, from: "on_hold", to: "active", bulkId, bulkLabel: "Групповая смена статуса" }
      });
    });
    await dispatcher.runOnce();
    const bulkEntries = await request<Array<{ id: string; text: string }>>(endpoint, { method: "GET", token: alice.accessToken });
    expect(bulkEntries.data.filter((row) => row.text === "Групповая смена статуса")).toHaveLength(1);
  });
});
