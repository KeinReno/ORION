import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Задание 04 «Планирование»: тайм-блоки с конфликтами и идемпотентным переносом,
 * Гантт с CPM, dry-run последствий переноса, матрица «важно/срочно» с пресетами.
 *
 * Проверяется на настоящей PostgreSQL и через HTTP — та же оснастка, что у
 * time-calendar-contracts и time-entries: RLS, гварды и DTO участвуют целиком.
 */
describe("planning — blocks, gantt and matrix (задание 04)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `planning04-${runId}`;

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

  it("creates blocks with conflict warnings, enforces CAS and makes a repeated move idempotent", async () => {
    const alice = await register("blocks");
    const ws = alice.workspaceId;

    const event = await request<{ id: string }>(`/workspaces/${ws}/events`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Планёрка", startAt: "2026-12-01T10:00:00.000Z", endAt: "2026-12-01T11:00:00.000Z" }
    });
    expect(event.status).toBe(201);

    const first = await request<BlockBody>(`/workspaces/${ws}/planning/blocks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Фокус", startAt: "2026-12-01T10:30:00.000Z", endAt: "2026-12-01T11:30:00.000Z" }
    });
    expect(first.status).toBe(201);
    // Пересечение с событием — предупреждение, а не отказ: 30 минут наложения.
    expect(first.data.conflicts).toEqual([
      expect.objectContaining({ kind: "event", id: event.data.id, minutes: 30 })
    ]);
    expect(first.data.revision).toBe(1);

    const second = await request<BlockBody>(`/workspaces/${ws}/planning/blocks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Встреча", startAt: "2026-12-01T11:00:00.000Z", endAt: "2026-12-01T12:00:00.000Z" }
    });
    expect(second.status).toBe(201);
    // Второй блок пересекается с первым на 30 минут; событие кончается ровно в
    // 11:00, поэтому касание границей конфликтом не считается.
    expect(second.data.conflicts).toEqual([expect.objectContaining({ kind: "block", id: first.data.id, minutes: 30 })]);

    const stale = await request(`/workspaces/${ws}/planning/blocks/${first.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Фокус 2", expectedRevision: 99 }
    });
    expect(stale.status).toBe(409);
    expect((stale.data as { code?: string }).code).toBe("planning_block_revision_conflict");

    const mutation = "move-00000001";
    const moved = await request<{ block: BlockBody; conflicts: unknown[]; impact: { shiftMinutes: number }; replayed: boolean }>(
      `/workspaces/${ws}/planning/blocks/${first.data.id}/move`,
      {
        method: "POST",
        token: alice.accessToken,
        body: { startAt: "2026-12-02T10:30:00.000Z", expectedRevision: 1, clientMutationId: mutation }
      }
    );
    expect(moved.status).toBe(201);
    expect(moved.data.replayed).toBe(false);
    expect(moved.data.block.revision).toBe(2);
    expect(moved.data.block.startAt).toBe("2026-12-02T10:30:00.000Z");
    // Длительность сохранена: 10:30–11:30 → 10:30–11:30 следующего дня.
    expect(moved.data.block.endAt).toBe("2026-12-02T11:30:00.000Z");
    expect(moved.data.impact.shiftMinutes).toBe(24 * 60);

    const replay = await request<{ block: BlockBody; replayed: boolean }>(
      `/workspaces/${ws}/planning/blocks/${first.data.id}/move`,
      {
        method: "POST",
        token: alice.accessToken,
        body: { startAt: "2026-12-02T10:30:00.000Z", clientMutationId: mutation }
      }
    );
    expect(replay.status).toBe(201);
    expect(replay.data.replayed).toBe(true);
    // Повтор не двигает блок второй раз: ревизия та же.
    expect(replay.data.block.revision).toBe(2);

    const published = await prisma.asSystem(async (tx) =>
      tx.domainEvent.count({ where: { workspaceId: ws, type: "planning.block.moved" } })
    );
    expect(published).toBe(1);

    const listed = await request<BlockBody[]>(`/workspaces/${ws}/planning/blocks?from=2026-12-01T00:00:00.000Z&to=2026-12-05T00:00:00.000Z`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(listed.status).toBe(200);
    expect(listed.data.map((block) => block.title).sort()).toEqual(["Встреча", "Фокус"]);

    const removed = await request(`/workspaces/${ws}/planning/blocks/${second.data.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(removed.status).toBe(204);
    const gone = await request(`/workspaces/${ws}/planning/blocks/${second.data.id}`, { method: "GET", token: alice.accessToken });
    expect(gone.status).toBe(404);
  });

  it("does not warn about calendar overlaps while the calendar module is off", async () => {
    const alice = await register("calendar-off");
    const ws = alice.workspaceId;
    const event = await request<{ id: string }>(`/workspaces/${ws}/events`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Отпуск", startAt: "2026-12-03T09:00:00.000Z", endAt: "2026-12-03T18:00:00.000Z" }
    });
    expect(event.status).toBe(201);
    const off = await request(`/workspaces/${ws}/modules/calendar`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false, confirm: true }
    });
    expect(off.status).toBe(200);

    const block = await request<BlockBody>(`/workspaces/${ws}/planning/blocks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Работа", startAt: "2026-12-03T10:00:00.000Z", endAt: "2026-12-03T11:00:00.000Z" }
    });
    expect(block.status).toBe(201);
    expect(block.data.conflicts).toEqual([]);
  });

  it("builds the Gantt with the hand-computed critical path for an 8-task project", async () => {
    const alice = await register("gantt");
    const ws = alice.workspaceId;
    const project = await request<{ id: string }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Запуск" }
    });
    expect(project.status).toBe(201);

    // Те же длительности, что в unit-фикстуре planning.test.ts, но в датах.
    const specs: Array<[string, string, string, string[]]> = [
      ["A", "2026-12-01T00:00:00.000Z", "2026-12-01T01:00:00.000Z", []],
      ["B", "2026-12-01T01:00:00.000Z", "2026-12-01T03:00:00.000Z", ["A"]],
      ["C", "2026-12-01T01:00:00.000Z", "2026-12-01T01:30:00.000Z", ["A"]],
      ["D", "2026-12-01T03:00:00.000Z", "2026-12-01T04:00:00.000Z", ["B"]],
      ["E", "2026-12-01T01:30:00.000Z", "2026-12-01T03:00:00.000Z", ["C"]],
      ["F", "2026-12-01T00:00:00.000Z", "2026-12-01T00:45:00.000Z", []],
      ["G", "2026-12-01T04:00:00.000Z", "2026-12-01T04:30:00.000Z", ["D", "E"]],
      ["H", "2026-12-01T00:45:00.000Z", "2026-12-01T01:45:00.000Z", ["F"]]
    ];
    const ids = new Map<string, string>();
    for (const [key, startAt, dueAt, dependsOnKeys] of specs) {
      const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
        method: "POST",
        token: alice.accessToken,
        body: {
          title: key,
          projectId: project.data.id,
          startAt,
          dueAt,
          dependencyIds: dependsOnKeys.map((dependencyKey) => ids.get(dependencyKey)!)
        }
      });
      expect(task.status).toBe(201);
      ids.set(key, task.data.id);
    }

    const gantt = await request<GanttBody>(`/workspaces/${ws}/planning/gantt?projectId=${project.data.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(gantt.status).toBe(200);
    expect(gantt.data.criticalPath).toEqual(["A", "B", "D", "G"].map((key) => ids.get(key)));
    expect(gantt.data.totalFloat[ids.get("C")!]).toBe(60);
    expect(gantt.data.totalFloat[ids.get("F")!]).toBe(165);
    expect(gantt.data.unscheduled).toEqual([]);
    expect(gantt.data.cycles).toEqual([]);
    expect(gantt.data.conflicts).toEqual([]);
    const taskB = gantt.data.tasks.find((task) => task.id === ids.get("B"));
    expect(taskB?.earliestStartAt).toBe("2026-12-01T01:00:00.000Z");
    expect(taskB?.earliestFinishAt).toBe("2026-12-01T03:00:00.000Z");
  });

  it("reports reschedule consequences as a dry run and writes nothing", async () => {
    const alice = await register("impact");
    const ws = alice.workspaceId;
    const project = await request<{ id: string }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Релиз" }
    });
    const a = await createTask(ws, alice.accessToken, "A", "2026-12-01T10:00:00.000Z", "2026-12-01T11:00:00.000Z", project.data.id);
    const b = await createTask(ws, alice.accessToken, "B", "2026-12-01T11:00:00.000Z", "2026-12-01T12:00:00.000Z", project.data.id, [a]);
    const c = await createTask(ws, alice.accessToken, "C", "2026-12-01T12:00:00.000Z", "2026-12-01T13:00:00.000Z", project.data.id, [b]);
    const milestone = await request<{ id: string }>(`/workspaces/${ws}/milestones`, {
      method: "POST",
      token: alice.accessToken,
      body: { projectId: project.data.id, title: "Фаза 1", dueAt: "2026-12-01T12:00:00.000Z" }
    });
    expect(milestone.status).toBe(201);
    const patch = await request(`/workspaces/${ws}/tasks/${b}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { milestoneId: milestone.data.id }
    });
    expect(patch.status).toBe(200);
    const block = await request<BlockBody>(`/workspaces/${ws}/planning/blocks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Работа над A", taskId: a, startAt: "2026-12-01T10:00:00.000Z", endAt: "2026-12-01T11:00:00.000Z" }
    });
    expect(block.status).toBe(201);
    const event = await request<{ id: string }>(`/workspaces/${ws}/events`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Согласование", startAt: "2026-12-02T10:00:00.000Z", endAt: "2026-12-02T11:00:00.000Z" }
    });
    expect(event.status).toBe(201);
    await prisma.asSystem(async (tx) => {
      await tx.entityLink.create({
        data: { workspaceId: ws, sourceType: "task", sourceId: a, targetType: "event", targetId: event.data.id }
      });
    });

    const impact = await request<ImpactBody>(`/workspaces/${ws}/planning/reschedule-impact`, {
      method: "POST",
      token: alice.accessToken,
      body: { taskId: a, newDueAt: "2026-12-01T12:00:00.000Z" }
    });
    expect(impact.status).toBe(201);
    expect(impact.data.task.shiftMinutes).toBe(60);
    expect(impact.data.tasks.map((task) => [task.id, task.shiftMinutes])).toEqual([
      [b, 60],
      [c, 60]
    ]);
    expect(impact.data.milestones).toEqual([
      expect.objectContaining({ id: milestone.data.id, title: "Фаза 1", shiftMinutes: 60 })
    ]);
    expect(impact.data.blocks).toEqual([expect.objectContaining({ id: block.data.id, shiftMinutes: 60 })]);
    expect(impact.data.events).toEqual([expect.objectContaining({ id: event.data.id, shiftMinutes: 60 })]);

    // Dry-run: даты задач и блока не изменились.
    const tasks = await request<Array<{ id: string; startAt: string; dueAt: string }>>(`/workspaces/${ws}/tasks`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(tasks.data.find((task) => task.id === b)?.startAt).toBe("2026-12-01T11:00:00.000Z");
    const blocks = await request<BlockBody[]>(`/workspaces/${ws}/planning/blocks?taskId=${a}`, { method: "GET", token: alice.accessToken });
    expect(blocks.data[0]?.startAt).toBe("2026-12-01T10:00:00.000Z");
  });

  it("distributes tasks into quadrants by query and writes the quadrant back into the task", async () => {
    const alice = await register("matrix");
    const ws = alice.workspaceId;
    const importantUrgent = await createTask(ws, alice.accessToken, "Срочно и важно", null, null, null, undefined, {
      importance: 3,
      urgency: 3
    });
    const importantOnly = await createTask(ws, alice.accessToken, "Важно", null, null, null, undefined, {
      importance: 3,
      urgency: 0
    });
    const urgentOnly = await createTask(ws, alice.accessToken, "Срочно", null, null, null, undefined, {
      importance: 0,
      urgency: 3
    });
    const neither = await createTask(ws, alice.accessToken, "Потом", null, null, null, undefined, {
      importance: 0,
      urgency: 0
    });

    const matrix = await request<MatrixBody>(`/workspaces/${ws}/planning/matrix`, { method: "GET", token: alice.accessToken });
    expect(matrix.status).toBe(200);
    const byId = new Map(matrix.data.quadrants.map((cell) => [cell.id, cell.tasks.map((task) => task.id)]));
    expect(byId.get("q1")).toEqual([importantUrgent]);
    expect(byId.get("q2")).toEqual([importantOnly]);
    expect(byId.get("q3")).toEqual([urgentOnly]);
    expect(byId.get("q4")).toEqual([neither]);
    expect(matrix.data.preset.id).toBe("eisenhower");
    expect(matrix.data.degraded).toBe(false);

    const assigned = await request<AssignBody>(`/workspaces/${ws}/planning/matrix/assign`, {
      method: "POST",
      token: alice.accessToken,
      body: { taskId: neither, quadrant: "q1" }
    });
    expect(assigned.status).toBe(201);
    expect(assigned.data.applied).toEqual([
      expect.objectContaining({ axis: "x", field: "importance", value: 3 }),
      expect.objectContaining({ axis: "y", field: "urgency", value: 3 })
    ]);
    expect(assigned.data.skipped).toEqual([]);
    expect(assigned.data.task.importance).toBe(3);
    expect(assigned.data.task.urgency).toBe(3);

    const after = await request<MatrixBody>(`/workspaces/${ws}/planning/matrix`, { method: "GET", token: alice.accessToken });
    expect(new Map(after.data.quadrants.map((cell) => [cell.id, cell.count])).get("q1")).toBe(2);

    const stale = await request(`/workspaces/${ws}/planning/matrix/assign`, {
      method: "POST",
      token: alice.accessToken,
      body: { taskId: neither, quadrant: "q4", expectedRevision: 99 }
    });
    expect(stale.status).toBe(409);
  });

  it("keeps the built-in Eisenhower preset undeletable and refuses an axis on a missing custom field", async () => {
    const alice = await register("presets");
    const ws = alice.workspaceId;

    const presets = await request<Array<{ id: string; builtIn: boolean }>>(`/workspaces/${ws}/planning/presets`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(presets.status).toBe(200);
    expect(presets.data[0]).toMatchObject({ id: "eisenhower", builtIn: true });

    const removeBuiltIn = await request(`/workspaces/${ws}/planning/presets/eisenhower`, { method: "DELETE", token: alice.accessToken });
    expect(removeBuiltIn.status).toBe(409);
    expect((removeBuiltIn.data as { code?: string }).code).toBe("planning_preset_builtin");

    const custom = await request<{ id: string }>(`/workspaces/${ws}/planning/presets`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        name: "Мои оси",
        xAxis: { field: "priority", kind: "priority" },
        yAxis: { field: "status", kind: "status" }
      }
    });
    expect(custom.status).toBe(201);

    const missingField = await request(`/workspaces/${ws}/planning/presets`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        name: "Поле, которого нет",
        xAxis: { field: "no-such-field", kind: "customFieldId" },
        yAxis: { field: "urgency", kind: "urgency" }
      }
    });
    expect(missingField.status).toBe(409);
    expect((missingField.data as { code?: string }).code).toBe("planning_axis_unavailable");

    const matrix = await request<MatrixBody>(`/workspaces/${ws}/planning/matrix?presetId=${custom.data.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(matrix.status).toBe(200);
    expect(matrix.data.axes.x.assignable).toBe(true);
    // Статус — представление, а не поле квадранта.
    expect(matrix.data.axes.y.assignable).toBe(false);

    const removed = await request(`/workspaces/${ws}/planning/presets/${custom.data.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(removed.status).toBe(204);
  });

  it("stops serving planning when the workspace turns the module off", async () => {
    const alice = await register("module-off");
    const ws = alice.workspaceId;
    const off = await request(`/workspaces/${ws}/modules/planning`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false }
    });
    expect(off.status).toBe(200);
    const blocked = await request(`/workspaces/${ws}/planning/blocks`, { method: "GET", token: alice.accessToken });
    expect(blocked.status).toBe(409);
    const back = await request(`/workspaces/${ws}/modules/planning`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: true }
    });
    expect(back.status).toBe(200);
  });

  // --- helpers --------------------------------------------------------------

  interface BlockBody {
    id: string;
    revision: number;
    startAt: string;
    endAt: string;
    title: string;
    conflicts: Array<{ kind: string; id: string; minutes: number }>;
  }

  interface GanttBody {
    criticalPath: string[];
    totalFloat: Record<string, number>;
    tasks: Array<{ id: string; earliestStartAt: string | null; earliestFinishAt: string | null }>;
    unscheduled: string[];
    cycles: string[];
    conflicts: unknown[];
  }

  interface ImpactBody {
    task: { shiftMinutes: number };
    tasks: Array<{ id: string; shiftMinutes: number }>;
    milestones: Array<{ id: string; title: string; shiftMinutes: number }>;
    blocks: Array<{ id: string; shiftMinutes: number }>;
    events: Array<{ id: string; shiftMinutes: number }>;
  }

  interface MatrixBody {
    preset: { id: string };
    quadrants: Array<{ id: string; count: number; tasks: Array<{ id: string }> }>;
    axes: { x: { assignable: boolean }; y: { assignable: boolean } };
    degraded: boolean;
  }

  interface AssignBody {
    task: { importance: number | null; urgency: number | null; priority: string };
    applied: Array<{ axis: string; field: string; value: number }>;
    skipped: Array<{ axis: string; reason: string }>;
  }

  async function createTask(
    workspaceId: string,
    token: string,
    title: string,
    startAt: string | null,
    dueAt: string | null,
    projectId?: string | null,
    dependencyIds?: string[],
    planner?: { importance: number | null; urgency: number | null }
  ): Promise<string> {
    const response = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
      method: "POST",
      token,
      body: {
        title,
        ...(projectId ? { projectId } : {}),
        ...(startAt ? { startAt } : {}),
        ...(dueAt ? { dueAt } : {}),
        ...(dependencyIds ? { dependencyIds } : {}),
        ...(planner ?? {})
      }
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
