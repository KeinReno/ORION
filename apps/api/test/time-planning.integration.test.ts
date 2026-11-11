import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Задание 04, п. 4.4: пауза/возобновление таймера, переключение между задачами,
 * журнал ручных правок, недельный план и аналитика план/факт.
 *
 * Ключевые инварианты: один запущенный таймер на человека (даже при переключении
 * и гонке), пауза вычитается из длительности, свободный секундомер — законный
 * сценарий, а неоценённая задача не выдаёт себя за нулевой план.
 */
describe("time — pause, switch, plans and analytics (задание 04)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `time04-${runId}`;

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
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  it("subtracts an open pause from the running timer and records the manual correction", async () => {
    const alice = await register("pause");
    const ws = alice.workspaceId;

    const started = await request<TimeEntryBody>(`/workspaces/${ws}/time/start`, {
      method: "POST",
      token: alice.accessToken,
      body: { note: "работа" }
    });
    expect(started.status).toBe(201);

    // Управляем временем через БД: тест не должен зависеть от реальных секунд.
    const startedAt = new Date(Date.now() - 60 * 60_000);
    await prisma.asSystem(async (tx) => {
      await tx.timeEntry.update({ where: { id: started.data.id }, data: { startedAt } });
    });

    const paused = await request<TimeEntryBody>(`/workspaces/${ws}/time/pause`, { method: "POST", token: alice.accessToken });
    expect(paused.status).toBe(201);
    expect(paused.data.pausedAt).not.toBeNull();
    expect(paused.data.running).toBe(true);

    await prisma.asSystem(async (tx) => {
      await tx.timeEntry.update({
        where: { id: started.data.id },
        data: { pausedAt: new Date(Date.now() - 20 * 60_000) }
      });
    });

    const resumed = await request<TimeEntryBody>(`/workspaces/${ws}/time/resume`, { method: "POST", token: alice.accessToken });
    expect(resumed.status).toBe(201);
    expect(resumed.data.pausedAt).toBeNull();
    expect(resumed.data.pausedSeconds).toBeGreaterThanOrEqual(1_199);

    // Ручная правка: 09:00–10:00 при 20 минутах паузы = 40 минут.
    const corrected = await request<TimeEntryBody>(`/workspaces/${ws}/time/${started.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: {
        startedAt: "2026-12-01T09:00:00.000Z",
        endedAt: "2026-12-01T10:00:00.000Z",
        note: "исправлено"
      }
    });
    expect(corrected.status).toBe(200);
    expect(corrected.data.pausedSeconds).toBeGreaterThanOrEqual(1_199);
    expect(corrected.data.minutes).toBe(40);
    expect(corrected.data.editedAt).not.toBeNull();
    expect(corrected.data.edits.map((edit) => edit.field)).toEqual(expect.arrayContaining(["startedAt", "endedAt", "note"]));

    const events = await prisma.asSystem(async (tx) =>
      tx.domainEvent.count({ where: { workspaceId: ws, type: "time.entry.edited" } })
    );
    expect(events).toBe(1);
  });

  it("switch closes the previous timer, starts a new one and never leaves two running", async () => {
    const alice = await register("switch");
    const ws = alice.workspaceId;
    const firstTask = await createTask(ws, alice.accessToken, "Первая");
    const secondTask = await createTask(ws, alice.accessToken, "Вторая");

    await request(`/workspaces/${ws}/time/start`, { method: "POST", token: alice.accessToken, body: { taskId: firstTask } });

    const switched = await request<{ stopped: TimeEntryBody | null; started: TimeEntryBody }>(`/workspaces/${ws}/time/switch`, {
      method: "POST",
      token: alice.accessToken,
      body: { taskId: secondTask, note: "переключились" }
    });
    expect(switched.status).toBe(201);
    expect(switched.data.stopped?.taskId).toBe(firstTask);
    expect(switched.data.stopped?.endedAt).not.toBeNull();
    expect(switched.data.started.taskId).toBe(secondTask);

    const running = await request<TimeEntryBody | null>(`/workspaces/${ws}/time/running`, { method: "GET", token: alice.accessToken });
    expect(running.data?.id).toBe(switched.data.started.id);

    // Две гонящиеся команды переключения не оставляют двух таймеров: либо одна
    // из них 409 по уникальному индексу, либо вторая закрывает первую.
    const thirdTask = await createTask(ws, alice.accessToken, "Третья");
    const raced = await Promise.all([
      request(`/workspaces/${ws}/time/switch`, { method: "POST", token: alice.accessToken, body: { taskId: thirdTask } }),
      request(`/workspaces/${ws}/time/switch`, { method: "POST", token: alice.accessToken, body: { taskId: firstTask } })
    ]);
    for (const result of raced) expect([201, 409]).toContain(result.status);

    const all = await request<{ items: TimeEntryBody[] }>(`/workspaces/${ws}/time`, { method: "GET", token: alice.accessToken });
    expect(all.data.items.filter((entry) => entry.endedAt === null)).toHaveLength(1);

    const events = await prisma.asSystem(async (tx) =>
      tx.domainEvent.count({ where: { workspaceId: ws, type: "time.entry.switched" } })
    );
    expect(events).toBeGreaterThanOrEqual(1);
  });

  it("reports plan/fact: linked vs free time, task estimates and the weekly plan", async () => {
    const alice = await register("analytics");
    const ws = alice.workspaceId;
    const project = await request<{ id: string }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Проект с оценкой" }
    });
    const estimated = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Оценённая", estimatedMinutes: 120, projectId: project.data.id }
    });
    expect(estimated.status).toBe(201);
    const unestimated = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Без оценки", projectId: project.data.id }
    });
    expect(unestimated.status).toBe(201);

    const timed = await request(`/workspaces/${ws}/time`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        taskId: estimated.data.id,
        projectId: project.data.id,
        startedAt: "2026-11-11T09:00:00.000Z",
        endedAt: "2026-11-11T10:00:00.000Z",
        note: "по задаче"
      }
    });
    expect(timed.status).toBe(201);
    // Свободный секундомер: задача не выбрана — законный сценарий.
    const free = await request(`/workspaces/${ws}/time`, {
      method: "POST",
      token: alice.accessToken,
      body: { startedAt: "2026-11-11T11:00:00.000Z", endedAt: "2026-11-11T11:30:00.000Z", note: "без задачи" }
    });
    expect(free.status).toBe(201);

    const week = "2026-W46";
    const withPlan = await request<{ week: string; plannedMinutes: number }>(`/workspaces/${ws}/time/plans/${week}`, {
      method: "PUT",
      token: alice.accessToken,
      body: { plannedMinutes: 600, note: "спокойная неделя" }
    });
    expect(withPlan.status).toBe(200);
    expect(withPlan.data.plannedMinutes).toBe(600);

    const invalidWeek = await request(`/workspaces/${ws}/time/plans/2026-46`, {
      method: "PUT",
      token: alice.accessToken,
      body: { plannedMinutes: 60 }
    });
    expect(invalidWeek.status).toBe(400);

    const analytics = await request<AnalyticsBody>(
      `/workspaces/${ws}/time/analytics?from=2026-11-09T00:00:00.000Z&to=2026-11-16T00:00:00.000Z`,
      { method: "GET", token: alice.accessToken }
    );
    expect(analytics.status).toBe(200);
    expect(analytics.data.totals).toMatchObject({ minutes: 90, count: 2, linkedMinutes: 60, freeMinutes: 30 });
    expect(analytics.data.byTask.find((entry) => entry.taskId === estimated.data.id)?.minutes).toBe(60);
    expect(analytics.data.byProject.find((entry) => entry.projectId === project.data.id)?.minutes).toBe(60);
    expect(analytics.data.plan.estimatedMinutes).toBe(120);
    expect(analytics.data.plan.estimatedTaskCount).toBe(1);
    const taskPlan = analytics.data.plan.tasks.find((entry) => entry.taskId === estimated.data.id);
    expect(taskPlan).toMatchObject({ estimatedMinutes: 120, actualMinutes: 60, remainingMinutes: 60, overrun: false });
    const weekPlan = analytics.data.plan.weeks.find((entry) => entry.week === week);
    expect(weekPlan).toEqual({ week, plannedMinutes: 600, actualMinutes: 90 });

    const plans = await request<Array<{ week: string }>>(`/workspaces/${ws}/time/plans?fromWeek=2026-W45&toWeek=2026-W47`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(plans.data.map((plan) => plan.week)).toEqual([week]);

    const removed = await request(`/workspaces/${ws}/time/plans/${week}`, { method: "DELETE", token: alice.accessToken });
    expect(removed.status).toBe(204);
    const after = await request<AnalyticsBody>(`/workspaces/${ws}/time/analytics?from=2026-11-09T00:00:00.000Z&to=2026-11-16T00:00:00.000Z`, {
      method: "GET",
      token: alice.accessToken
    });
    // Нет плана — null, а не ноль: «не планировали» и «планировали ноль» разные вещи.
    expect(after.data.plan.weeks.find((entry) => entry.week === week)?.plannedMinutes).toBeNull();
  });

  // --- helpers --------------------------------------------------------------

  interface TimeEntryBody {
    id: string;
    taskId: string | null;
    endedAt: string | null;
    running: boolean;
    pausedAt: string | null;
    pausedSeconds: number;
    minutes: number;
    editedAt: string | null;
    edits: Array<{ field: string }>;
  }

  interface AnalyticsBody {
    totals: { minutes: number; count: number; linkedMinutes: number; freeMinutes: number };
    byTask: Array<{ taskId: string | null; minutes: number }>;
    byProject: Array<{ projectId: string | null; minutes: number }>;
    plan: {
      estimatedMinutes: number | null;
      estimatedTaskCount: number;
      tasks: Array<{ taskId: string; estimatedMinutes: number | null; actualMinutes: number; remainingMinutes: number | null; overrun: boolean }>;
      weeks: Array<{ week: string; plannedMinutes: number | null; actualMinutes: number }>;
    };
  }

  async function createTask(workspaceId: string, token: string, title: string): Promise<string> {
    const response = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
      method: "POST",
      token,
      body: { title }
    });
    expect(response.status).toBe(201);
    return response.data.id;
  }

  async function register(name: string): Promise<{ accessToken: string; user: { id: string }; workspaceId: string }> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

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
});
