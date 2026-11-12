import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Задание 03 — Центр проектов. Проверяет на реальной PostgreSQL:
 *  - иерархию: parentId, путь предков, защита от цикла (409 с путём) и лимит глубины;
 *  - шаблоны: from-template создаёт проект + вехи + задачи + журнал в одной транзакции,
 *    а сбой ПОСЕРЕДИНЕ (искусственная ошибка вставки задачи через триггер) не оставляет
 *    ни проекта, ни вех, ни задач;
 *  - duplicate: копия структуры без содержимого по умолчанию;
 *  - портфель: прогресс, просрочка, риски, дедлайны, загрузка по участникам, пагинация;
 *  - историю: кто/какое поле/когда + фильтры + связывание с записью журнала.
 */
describe("Центр проектов (задание 03)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `project-center-${runId}`;

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
        const workspaceIds = [...new Set(memberships.map((member) => member.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string, email = `${emailPrefix}-${name}@example.test`) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { token: response.data.accessToken, userId: response.data.user.id, workspaceId: workspaces.data[0]!.id, email };
  }

  interface ProjectDto {
    id: string;
    name: string;
    parentId: string | null;
    status: string;
    dueAt: string | null;
    startAt: string | null;
    progress: number;
  }
  interface ProjectDetailDto extends ProjectDto {
    ancestors: Array<{ id: string; name: string; depth: number }>;
    childCount: number;
  }

  async function createProject(token: string, workspaceId: string, body: Record<string, unknown>): Promise<ProjectDto> {
    const response = await request<ProjectDto>(`/workspaces/${workspaceId}/projects`, { method: "POST", token, body });
    expect(response.status, JSON.stringify(response.data)).toBe(201);
    return response.data;
  }

  describe("3.1 Иерархия", () => {
    it("родитель, путь предков, счётчик детей и защита от циклов", async () => {
      const owner = await register("hierarchy");
      const root = await createProject(owner.token, owner.workspaceId, { name: "Корень" });
      const child = await createProject(owner.token, owner.workspaceId, { name: "Ребёнок" });
      const grandchild = await createProject(owner.token, owner.workspaceId, { name: "Внук" });

      const link = await request<ProjectDto>(`/workspaces/${owner.workspaceId}/projects/${child.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { parentId: root.id }
      });
      expect(link.status).toBe(200);
      expect(link.data.parentId).toBe(root.id);

      await request(`/workspaces/${owner.workspaceId}/projects/${grandchild.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { parentId: child.id }
      });

      const detail = await request<ProjectDetailDto>(`/workspaces/${owner.workspaceId}/projects/${grandchild.id}`, { token: owner.token });
      expect(detail.data.ancestors.map((ancestor) => ancestor.name)).toEqual(["Корень", "Ребёнок"]);
      expect(detail.data.ancestors.map((ancestor) => ancestor.depth)).toEqual([1, 2]);
      const rootDetail = await request<ProjectDetailDto>(`/workspaces/${owner.workspaceId}/projects/${root.id}`, { token: owner.token });
      expect(rootDetail.data.childCount).toBe(1);

      // Цикл: корень внуком → 409 с путём цикла в тексте.
      const cycle = await request<{ code?: string; message?: string | string[] }>(`/workspaces/${owner.workspaceId}/projects/${root.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { parentId: grandchild.id }
      });
      expect(cycle.status).toBe(409);
      const message = Array.isArray(cycle.data.message) ? cycle.data.message.join(" ") : cycle.data.message ?? "";
      expect(message).toContain("Корень");
      expect(message).toContain("Внук");
      expect((cycle.data as { code?: string }).code).toBe("project_hierarchy_cycle");

      // Сам на себя — тоже 409.
      const self = await request(`/workspaces/${owner.workspaceId}/projects/${root.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { parentId: root.id }
      });
      expect(self.status).toBe(409);
    });

    it("дерево глубже шести уровней отвергается", async () => {
      const owner = await register("depth");
      let parentId: string | null = null;
      for (let level = 1; level <= 6; level++) {
        const project = await createProject(owner.token, owner.workspaceId, { name: `Уровень ${level}`, parentId });
        parentId = project.id;
      }
      const deep = await request<{ message?: string | string[] }>(`/workspaces/${owner.workspaceId}/projects`, {
        method: "POST",
        token: owner.token,
        body: { name: "Уровень 7", parentId }
      });
      expect(deep.status).toBe(400);
      const message = Array.isArray(deep.data.message) ? deep.data.message.join(" ") : deep.data.message ?? "";
      expect(message).toContain("глубже 6");
    });
  });

  describe("3.2 Шаблоны и дублирование", () => {
    const structure = {
      name: "шаблон-корень",
      description: "Описание шаблона",
      dueOffsetDays: 5,
      tasks: [
        { title: "Подготовка", startOffsetDays: 0, dueOffsetDays: 2, estimateMinutes: 120 },
        { title: "Запуск", startOffsetDays: 3, dueOffsetDays: 5, milestoneIndex: 0, status: "in_progress" }
      ],
      milestones: [{ title: "Веха запуска", startOffsetDays: 3, dueOffsetDays: 6, estimateMinutes: 240 }],
      logEntries: [{ kind: "decision", text: "Старт проекта", dayOffset: 0 }],
      children: [{ name: "Дочерний этап", startOffsetDays: 3, dueOffsetDays: 10, tasks: [{ title: "Задача этапа", startOffsetDays: 3 }] }]
    };

    it("from-template создаёт полную структуру атомарно", async () => {
      const owner = await register("template");
      const template = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects/templates`, {
        method: "POST",
        token: owner.token,
        body: { name: "Запуск продукта", description: "Стандартный запуск", structure }
      });
      expect(template.status).toBe(201);

      const created = await request<{ projectId: string; created: Record<string, number> }>(`/workspaces/${owner.workspaceId}/projects/from-template`, {
        method: "POST",
        token: owner.token,
        body: { templateId: template.data.id, name: "Новый запуск", startDate: "2026-03-02T00:00:00.000Z" }
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      expect(created.data.created).toEqual({ projects: 2, milestones: 1, tasks: 3, logEntries: 1 });

      const detail = await request<ProjectDetailDto>(`/workspaces/${owner.workspaceId}/projects/${created.data.projectId}`, { token: owner.token });
      expect(detail.data.startAt).toBe("2026-03-02T00:00:00.000Z");
      expect(detail.data.dueAt).toBe("2026-03-07T00:00:00.000Z");
      expect(detail.data.childCount).toBe(1);

      const milestones = await request<Array<{ id: string; title: string; startAt: string | null; dueAt: string | null }>>(
        `/workspaces/${owner.workspaceId}/milestones?projectId=${created.data.projectId}`,
        { token: owner.token }
      );
      expect(milestones.data.map((milestone) => milestone.title)).toEqual(["Веха запуска"]);
      expect(milestones.data[0]!.startAt).toBe("2026-03-05T00:00:00.000Z");

      const tasks = await request<Array<{ title: string; status: string; milestoneId: string | null; startAt: string | null; dueAt: string | null; projectId: string | null }>>(
        `/workspaces/${owner.workspaceId}/tasks`,
        { token: owner.token }
      );
      const byTitle = new Map(tasks.data.filter((task) => task.projectId === created.data.projectId).map((task) => [task.title, task]));
      expect(byTitle.get("Подготовка")?.startAt).toBe("2026-03-02T00:00:00.000Z");
      expect(byTitle.get("Подготовка")?.dueAt).toBe("2026-03-04T00:00:00.000Z");
      expect(byTitle.get("Запуск")?.status).toBe("in_progress");
      expect(byTitle.get("Запуск")?.milestoneId).toBe(milestones.data[0]!.id);

      const logbook = await request<Array<{ type: string; text: string }>>(`/workspaces/${owner.workspaceId}/projects/${created.data.projectId}/logbook`, { token: owner.token });
      expect(logbook.status).toBe(200);
      expect(logbook.data.some((entry) => entry.text === "Старт проекта" && entry.type === "decision")).toBe(true);

      // Дочерний проект получил свои даты от той же стартовой даты.
      const tree = await request<ProjectDto[]>(`/workspaces/${owner.workspaceId}/projects`, { token: owner.token });
      const child = tree.data.find((project) => project.name === "Дочерний этап");
      expect(child?.parentId).toBe(created.data.projectId);
      expect(child?.startAt).toBe("2026-03-05T00:00:00.000Z");
    });

    it("сбой посередине не оставляет ни проекта, ни структуры", async () => {
      const owner = await register("rollback");
      const template = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects/templates`, {
        method: "POST",
        token: owner.token,
        body: {
          name: "Шаблон со сбоем",
          structure: {
            name: "шаблон",
            milestones: [{ title: "Веха" }],
            tasks: [{ title: "BOOM", startOffsetDays: 0 }],
            children: [{ name: "Ребёнок" }]
          }
        }
      });
      expect(template.status).toBe(201);

      // Инъекция отказа на вставке задачи: транзакция обязана откатить уже созданные
      // проект, веху и журнал (иначе критерий приёмки №2 не выполнен).
      // Отдельный клиент под DATABASE_URL (суперпользователь): DDL/триггер не проходит
      // через роль orion_app и не зависит от RLS тестового приложения.
      const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
      await client.$connect();
      try {
        await client.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION orion_test_fail_task() RETURNS trigger AS $$
          BEGIN IF NEW."title" = 'BOOM' THEN RAISE EXCEPTION 'injected task insert failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS orion_test_fail_task_trigger ON "tasks"`);
        await client.$executeRawUnsafe(`CREATE TRIGGER orion_test_fail_task_trigger BEFORE INSERT ON "tasks" FOR EACH ROW EXECUTE FUNCTION orion_test_fail_task()`);

        const failed = await request<unknown>(`/workspaces/${owner.workspaceId}/projects/from-template`, {
          method: "POST",
          token: owner.token,
          body: { templateId: template.data.id, name: "Не должно появиться" }
        });
        expect(failed.status).toBe(500);

        const projects = await request<ProjectDto[]>(`/workspaces/${owner.workspaceId}/projects`, { token: owner.token });
        expect(projects.data.map((project) => project.name)).not.toContain("Не должно появиться");
        const names = projects.data.map((project) => project.name);
        expect(names).not.toContain("Ребёнок");
        const milestones = await prisma.asSystem((tx) => tx.milestone.count({ where: { workspaceId: owner.workspaceId } }));
        expect(milestones).toBe(0);
      } finally {
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS orion_test_fail_task_trigger ON "tasks"`);
        await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS orion_test_fail_task()`);
        await client.$disconnect();
      }
    });

    it("duplicate копирует структуру без содержимого и дочерних проектов по умолчанию их сохраняет", async () => {
      const owner = await register("duplicate");
      const source = await createProject(owner.token, owner.workspaceId, { name: "Оригинал", description: "Текст оригинала" });
      await request(`/workspaces/${owner.workspaceId}/milestones`, {
        method: "POST",
        token: owner.token,
        body: { projectId: source.id, title: "Фаза 1", startAt: "2026-04-01T00:00:00.000Z", dueAt: "2026-04-05T00:00:00.000Z" }
      });
      const taskResponse = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/tasks`, {
        method: "POST",
        token: owner.token,
        body: { title: "Задача оригинала", description: "Секрет", projectId: source.id, startAt: "2026-04-01T00:00:00.000Z" }
      });
      expect(taskResponse.status).toBe(201);
      await request(`/workspaces/${owner.workspaceId}/projects`, { method: "POST", token: owner.token, body: { name: "Дочерний оригинала", parentId: source.id } });

      const copy = await request<{ projectId: string; created: Record<string, number> }>(`/workspaces/${owner.workspaceId}/projects/${source.id}/duplicate`, {
        method: "POST",
        token: owner.token,
        body: {}
      });
      expect(copy.status, JSON.stringify(copy.data)).toBe(201);
      expect(copy.data.created.tasks).toBe(1);
      expect(copy.data.created.milestones).toBe(1);
      expect(copy.data.created.projects).toBe(2);

      const copyDetail = await request<ProjectDetailDto>(`/workspaces/${owner.workspaceId}/projects/${copy.data.projectId}`, { token: owner.token });
      expect(copyDetail.data.name).toContain("копия");
      expect((copyDetail.data as unknown as { description: string }).description).toBe("");

      const copyTasks = await request<Array<{ title: string; description: string; projectId: string | null }>>(`/workspaces/${owner.workspaceId}/tasks`, { token: owner.token });
      expect(copyTasks.data.filter((task) => task.projectId === copy.data.projectId).map((task) => task.description)).toEqual([""]);

      // withContent: true — описания копируются.
      const withContent = await request<{ projectId: string }>(`/workspaces/${owner.workspaceId}/projects/${source.id}/duplicate`, {
        method: "POST",
        token: owner.token,
        body: { withContent: true, withChildren: false, name: "Копия с текстом" }
      });
      expect(withContent.status).toBe(201);
      const textTasks = await request<Array<{ description: string; projectId: string | null }>>(`/workspaces/${owner.workspaceId}/tasks`, { token: owner.token });
      expect(textTasks.data.filter((task) => task.projectId === withContent.data.projectId).map((task) => task.description)).toEqual(["Секрет"]);
    });

    it("шаблон не удаляется, а архивируется; второй шаблон с тем же именем — 409", async () => {
      const owner = await register("template-lifecycle");
      const first = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects/templates`, {
        method: "POST",
        token: owner.token,
        body: { name: "Одинаковый", structure: { name: "шаблон" } }
      });
      expect(first.status).toBe(201);
      const duplicate = await request(`/workspaces/${owner.workspaceId}/projects/templates`, {
        method: "POST",
        token: owner.token,
        body: { name: "Одинаковый", structure: { name: "шаблон" } }
      });
      expect(duplicate.status).toBe(409);

      const archived = await request<{ archivedAt: string | null }>(`/workspaces/${owner.workspaceId}/projects/templates/${first.data.id}`, {
        method: "DELETE",
        token: owner.token
      });
      expect(archived.status).toBe(200);
      expect(archived.data.archivedAt).not.toBeNull();
      const active = await request<unknown[]>(`/workspaces/${owner.workspaceId}/projects/templates`, { token: owner.token });
      expect(active.data).toHaveLength(0);
      const archivedList = await request<unknown[]>(`/workspaces/${owner.workspaceId}/projects/templates?archived=true`, { token: owner.token });
      expect(archivedList.data).toHaveLength(1);
    });
  });

  describe("3.3 Портфель", () => {
    it("считает прогресс, риски, дедлайны, загрузку и уважает пагинацию", async () => {
      const owner = await register("portfolio");
      const workspaceId = owner.workspaceId;
      const inProgress = await createProject(owner.token, workspaceId, { name: "В работе", startAt: "2027-01-01T00:00:00.000Z", dueAt: "2027-01-20T00:00:00.000Z" });
      const overdue = await createProject(owner.token, workspaceId, { name: "Просрочен", dueAt: "2020-01-01T00:00:00.000Z" });
      const empty = await createProject(owner.token, workspaceId, { name: "Без задач", startAt: "2027-01-01T00:00:00.000Z", dueAt: "2027-02-01T00:00:00.000Z" });
      const blocked = await createProject(owner.token, workspaceId, { name: "Зависит", dueAt: "2027-03-01T00:00:00.000Z" });

      // Задачи: 1 сделана, 1 открыта на иполнителе, 1 открыта без исполнителя.
      const membership = await prisma.asSystem((tx) => tx.workspaceMember.findFirst({ where: { workspaceId, userId: owner.userId }, select: { id: true } }));
      const memberId = membership!.id;
      const done = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        token: owner.token,
        body: { title: "Готово", projectId: inProgress.id }
      });
      await request(`/workspaces/${workspaceId}/tasks/${done.data.id}`, { method: "PATCH", token: owner.token, body: { status: "done" } });
      // Плагин «Команда» в новом пространстве выключен, поэтому исполнитель ставится
      // напрямую в БД: портфель проверяет ЧТЕНИЕ загрузки, а не право назначать.
      const assigned = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        token: owner.token,
        body: { title: "Открытая", projectId: inProgress.id }
      });
      expect(assigned.status, JSON.stringify(assigned.data)).toBe(201);
      const mine = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, { method: "POST", token: owner.token, body: { title: "На мне", projectId: overdue.id } });
      expect(mine.status, JSON.stringify(mine.data)).toBe(201);
      const unassigned = await request(`/workspaces/${workspaceId}/tasks`, { method: "POST", token: owner.token, body: { title: "Без исполнителя", projectId: blocked.id } });
      expect(unassigned.status, JSON.stringify(unassigned.data)).toBe(201);
      await prisma.asSystem((tx) => tx.task.updateMany({ where: { id: { in: [assigned.data.id, mine.data.id] } }, data: { assigneeId: memberId } }));

      // Веха без даты — риск.
      await request(`/workspaces/${workspaceId}/milestones`, { method: "POST", token: owner.token, body: { projectId: inProgress.id, title: "Без срока" } });
      // «Зависит» зависит от проекта на паузе.
      await request(`/workspaces/${workspaceId}/projects/${empty.id}`, { method: "PATCH", token: owner.token, body: { status: "on_hold" } });
      await request(`/workspaces/${workspaceId}/projects/${blocked.id}/relations`, {
        method: "POST",
        token: owner.token,
        body: { type: "depends_on", toProjectId: empty.id }
      });

      const portfolio = await request<{
        totals: { projects: number; tasks: number; openTasks: number; overdueProjects: number; projectsAtRisk: number; byStatus: Array<{ status: string; count: number }> };
        items: Array<{ id: string; progress: number; openTasks: number; overdue: boolean; riskLevel: string | null }>;
        page: { total: number; limit: number; offset: number; truncated: boolean };
        deadlines: Array<{ projectId: string; daysLeft: number }>;
        risks: Array<{ projectId: string; kind: string; level: string }>;
        workload: Array<{ memberId: string; openTasks: number; name: string | null }>;
      }>(`/workspaces/${workspaceId}/projects/portfolio`, { token: owner.token });
      expect(portfolio.status, JSON.stringify(portfolio.data)).toBe(200);
      expect(portfolio.data.totals.projects).toBe(4);
      expect(portfolio.data.totals.tasks).toBe(4);
      expect(portfolio.data.totals.openTasks).toBe(3);
      expect(portfolio.data.totals.overdueProjects).toBe(1);
      expect(portfolio.data.page.total).toBe(4);
      expect(portfolio.data.page.truncated).toBe(false);

      const item = portfolio.data.items.find((entry) => entry.id === inProgress.id);
      expect(item?.progress).toBe(50);
      expect(item?.openTasks).toBe(1);
      expect(item?.overdue).toBe(false);
      // «В работе»: единственный риск — веха без даты (medium).
      expect(item?.riskLevel).toBe("medium");

      const kinds = portfolio.data.risks.map((risk) => risk.kind);
      expect(kinds).toContain("milestone_without_dates");
      expect(kinds).toContain("overdue");
      expect(kinds).toContain("blocked_dependency");
      expect(kinds).toContain("no_tasks");
      // high-риски идут первыми.
      expect(portfolio.data.risks[0]!.level).toBe("high");

      expect(portfolio.data.workload.find((entry) => entry.memberId === memberId)?.openTasks).toBe(2);
      expect(portfolio.data.deadlines.some((deadline) => deadline.projectId === blocked.id)).toBe(true);

      // Пагинация: страница не меняет агрегаты.
      const page = await request<{ items: unknown[]; page: { total: number; truncated: boolean }; totals: { projects: number } }>(
        `/workspaces/${workspaceId}/projects/portfolio?limit=2&offset=0`,
        { token: owner.token }
      );
      expect(page.data.items).toHaveLength(2);
      expect(page.data.page.total).toBe(4);
      expect(page.data.totals.projects).toBe(4); // пагинация не сужает агрегаты, только items

      // Фильтр по участнику сужает портфель до проектов с его открытыми задачами.
      const byMember = await request<{ totals: { projects: number }; items: Array<{ id: string }> }>(
        `/workspaces/${workspaceId}/projects/portfolio?memberId=${memberId}`,
        { token: owner.token }
      );
      const projectIds = byMember.data.items.map((entry) => entry.id).sort();
      expect(projectIds).toEqual([inProgress.id, overdue.id].sort());
    });

    it("архивные проекты не попадают в активный портфель", async () => {
      const owner = await register("portfolio-archive");
      const project = await createProject(owner.token, owner.workspaceId, { name: "Архивный" });
      await request(`/workspaces/${owner.workspaceId}/projects/${project.id}`, { method: "DELETE", token: owner.token });
      const active = await request<{ items: unknown[] }>(`/workspaces/${owner.workspaceId}/projects/portfolio`, { token: owner.token });
      expect(active.data.items).toHaveLength(0);
      const archived = await request<{ items: Array<{ id: string }> }>(`/workspaces/${owner.workspaceId}/projects/portfolio?scope=archived`, { token: owner.token });
      expect(archived.data.items.map((item) => item.id)).toEqual([project.id]);
    });
  });

  describe("3.4 История изменений", () => {
    it("пишет кто/что/когда, фильтрует по полю и периоду и связывается с записью журнала", async () => {
      const owner = await register("history");
      const project = await createProject(owner.token, owner.workspaceId, { name: "С историей" });

      await request(`/workspaces/${owner.workspaceId}/projects/${project.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { name: "Переименован", status: "on_hold", dueAt: "2026-06-01T00:00:00.000Z" }
      });
      // Повторная отправка того же значения историю НЕ пишет.
      await request(`/workspaces/${owner.workspaceId}/projects/${project.id}`, { method: "PATCH", token: owner.token, body: { name: "Переименован" } });

      const history = await request<{ items: Array<{ id: string; field: string; fromValue: string | null; toValue: string | null; actorId: string | null; actorName: string | null; createdAt: string }>; total: number }>(
        `/workspaces/${owner.workspaceId}/projects/${project.id}/history`,
        { token: owner.token }
      );
      expect(history.status, JSON.stringify(history.data)).toBe(200);
      const fields = history.data.items.map((entry) => entry.field);
      expect(fields).toContain("name");
      expect(fields).toContain("status");
      expect(fields).toContain("dueAt");
      expect(history.data.total).toBe(3);
      expect(history.data.items.every((entry) => entry.actorId === owner.userId && entry.actorName === "history")).toBe(true);

      const onlyStatus = await request<{ items: Array<{ field: string; toValue: string | null }> }>(
        `/workspaces/${owner.workspaceId}/projects/${project.id}/history?field=status`,
        { token: owner.token }
      );
      expect(onlyStatus.data.items.map((entry) => entry.toValue)).toEqual(["on_hold"]);

      const inFuture = await request<{ items: unknown[] }>(
        `/workspaces/${owner.workspaceId}/projects/${project.id}/history?from=2030-01-01T00:00:00.000Z`,
        { token: owner.token }
      );
      expect(inFuture.data.items).toHaveLength(0);

      // Запись журнала для связывания.
      const entry = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects/${project.id}/logbook`, {
        method: "POST",
        token: owner.token,
        body: { type: "decision", text: "Ставим на паузу", rationale: "Сроки сдвинулись" }
      });
      expect(entry.status).toBe(201);
      const statusChange = onlyStatus.data.items[0] as unknown as { id: string };

      const linked = await request<{ logEntryId: string | null }>(`/workspaces/${owner.workspaceId}/projects/${project.id}/history/${statusChange.id}/decision`, {
        method: "POST",
        token: owner.token,
        body: { entryId: entry.data.id }
      });
      expect(linked.status).toBe(201);
      expect(linked.data.logEntryId).toBe(entry.data.id);

      const unlinked = await request<{ logEntryId: string | null }>(`/workspaces/${owner.workspaceId}/projects/${project.id}/history/${statusChange.id}/decision`, {
        method: "DELETE",
        token: owner.token
      });
      expect(unlinked.status).toBe(200);
      expect(unlinked.data.logEntryId).toBeNull();
    });

    it("родитель в истории отмечается событием parent_changed", async () => {
      const owner = await register("history-parent");
      const parent = await createProject(owner.token, owner.workspaceId, { name: "Родитель" });
      const child = await createProject(owner.token, owner.workspaceId, { name: "Ребёнок" });
      await request(`/workspaces/${owner.workspaceId}/projects/${child.id}`, { method: "PATCH", token: owner.token, body: { parentId: parent.id } });

      const history = await request<{ items: Array<{ field: string; fromValue: string | null; toValue: string | null }> }>(
        `/workspaces/${owner.workspaceId}/projects/${child.id}/history?field=parentId`,
        { token: owner.token }
      );
      expect(history.data.items).toHaveLength(1);
      expect(history.data.items[0]!.toValue).toBe(parent.id);

      const events = await prisma.asSystem((tx) =>
        tx.domainEvent.findMany({ where: { workspaceId: owner.workspaceId, type: "projects.project.parent_changed" }, select: { payload: true } })
      );
      expect(events).toHaveLength(1);
      expect((events[0]!.payload as { parentId: string }).parentId).toBe(parent.id);
    });
  });
});
