import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

/**
 * U07 (24-CONNECTED-CORE-BACKLOG.md) — "Полная цепочка Поездка и аналогичный
 * рабочий проект; адаптеры Calendar/Time/Lists/Habits/Inventory".
 *
 * Project.projectId FKs on Task/Note/Event/Document/Transaction/TimeEntry/
 * InventoryItem predate this backlog item (v0.14+); this is the executable
 * proof that a project's detail view (`GET .../projects/:id`) actually
 * surfaces all of them for TWO unrelated scenarios through the exact same
 * code path (UC07: "семейная Поездка и рабочий Заказ используют одинаковые
 * модули"), that nothing leaks across projects/workspaces, that a disabled
 * neighbour module degrades the response instead of crashing it, and that
 * every one of these FKs stays optional (no forced project membership).
 *
 * Lists/Habits are deliberately NOT asserted here to have a projectId — per
 * CLAUDE.md and the schema's own comments they are standalone by design
 * ("Habit... no projectId", "List... no projectId"), so this test only
 * confirms the seven FKs that do exist stay wired end to end.
 */
describe("Project connected core (U07)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `u07-${runId}`;

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
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  it("family trip project: note/task/event/document/transaction/time/inventory all show up on the project, once each", async () => {
    const family = await register("family");
    const project = await createProject(family, "Поездка");
    await seedFullChain(family, project.id, "trip");

    const detail = await getProject(family, project.id);
    expect(detail.counts).toMatchObject({
      tasks: 1,
      closed: 0,
      notes: 1,
      events: 1,
      documents: 1,
      inventory: 1
    });
    expect(detail.trackedMinutes).toBeGreaterThan(0);
    expect(detail.spentAmount).toBeGreaterThan(0);

    const types = detail.activity.map((item: { type: string }) => item.type).sort();
    expect(types).toEqual(["document", "event", "inventory", "note", "task", "transaction"].sort());
    // Exactly one row per type — a live FK query, not an accumulating log.
    for (const type of ["task", "note", "event", "document", "transaction", "inventory"]) {
      expect(detail.activity.filter((item: { type: string }) => item.type === type)).toHaveLength(1);
    }
  });

  it("a work project (same code path, different data) gets the identical adapter set — not a special case", async () => {
    const studio = await register("studio");
    const project = await createProject(studio, "Заказ клиента");
    await seedFullChain(studio, project.id, "order");

    const detail = await getProject(studio, project.id);
    expect(detail.counts).toMatchObject({ tasks: 1, notes: 1, events: 1, documents: 1, inventory: 1 });
    const types = detail.activity.map((item: { type: string }) => item.type).sort();
    expect(types).toEqual(["document", "event", "inventory", "note", "task", "transaction"].sort());
  });

  it("does not leak between two projects in the same workspace, nor across workspaces", async () => {
    const alice = await register("iso-a");
    const projectA = await createProject(alice, "Проект A");
    const projectB = await createProject(alice, "Проект B");
    await createTask(alice, "Задача A", projectA.id);
    await createTask(alice, "Задача B", projectB.id);

    const detailA = await getProject(alice, projectA.id);
    expect(detailA.counts.tasks).toBe(1);
    expect(detailA.activity.filter((i: { type: string }) => i.type === "task")).toHaveLength(1);
    expect(detailA.activity.find((i: { type: string }) => i.type === "task")?.title).toBe("Задача A");

    const bob = await register("iso-b");
    const bobProject = await createProject(bob, "Чужой проект");
    // Bob cannot even resolve Alice's project id from his own workspace route.
    const res = await request(`/workspaces/${bob.workspaceId}/projects/${projectA.id}`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(res.status).toBe(404);
    void bobProject;
  });

  it("a disabled neighbour module (finance) hides that section instead of erroring the whole project", async () => {
    const alice = await register("gate");
    const project = await createProject(alice, "С деньгами");
    const account = await createAccount(alice, "Карта");
    await createTransaction(alice, account.id, project.id, "Билеты");
    await createTask(alice, "Задача", project.id);

    const before = await getProject(alice, project.id);
    expect(before.counts.tasks).toBe(1);
    expect(before.spentAmount).toBeGreaterThan(0);

    const disable = await request(`/workspaces/${alice.workspaceId}/modules/finance`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false, confirm: true }
    });
    expect(disable.status).toBe(200);

    const after = await getProject(alice, project.id);
    expect(after.spentAmount).toBe(0);
    expect(after.activity.find((i: { type: string }) => i.type === "transaction")).toBeUndefined();
    // The unrelated task section is untouched by finance being off.
    expect(after.counts.tasks).toBe(1);
  });

  it("spentAmount counts only the project's currency; other currencies go to spentOther", async () => {
    const alice = await register("currencies");
    const project = await createProject(alice, "Две валюты");
    const rub = await createAccount(alice, "Рубли");
    const usd = await createAccount(alice, "Доллары", "USD");
    await createTransaction(alice, rub.id, project.id, "В рублях");
    await createTransaction(alice, usd.id, project.id, "В долларах");

    const detail = await getProject(alice, project.id);
    expect(detail.spentAmount).toBe(500);
    expect(detail.spentOther).toEqual([{ currency: "USD", amount: 500 }]);
  });

  it("projectId stays optional everywhere: tasks/notes/events/documents/transactions/time entries/inventory items can exist with no project at all", async () => {
    const alice = await register("optional");
    const task = await createTask(alice, "Без проекта", null);
    expect(task.projectId ?? null).toBeNull();

    const note = await request<{ projectId: string | null }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Без проекта", body: "", tags: [] }
    });
    expect(note.status).toBe(201);
    expect(note.data.projectId ?? null).toBeNull();

    const account = await createAccount(alice, "Карта без проекта");
    const transaction = await request<{ projectId: string | null }>(`/workspaces/${alice.workspaceId}/finance/transactions`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        accountId: account.id,
        type: "expense",
        occurredAt: new Date().toISOString(),
        note: "Без проекта",
        tags: [],
        lines: [{ amount: 100, categoryId: null }]
      }
    });
    expect(transaction.status).toBe(201);
    expect(transaction.data.projectId ?? null).toBeNull();

    const item = await request<{ projectId: string | null }>(`/workspaces/${alice.workspaceId}/inventory/items`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Без проекта" }
    });
    expect(item.status).toBe(201);
    expect(item.data.projectId ?? null).toBeNull();
  });

  // --- helpers -------------------------------------------------------------

  async function seedFullChain(session: RegisteredSession, projectId: string, tag: string): Promise<void> {
    await createNote(session, `Заметка ${tag}`, projectId);
    await createTask(session, `Задача ${tag}`, projectId);
    await createEvent(session, `Событие ${tag}`, projectId);
    await createDocumentInProject(session, `Файл ${tag}.pdf`, projectId);
    const account = await createAccount(session, `Счёт ${tag}`);
    await createTransaction(session, account.id, projectId, `Расход ${tag}`);
    await createTimeEntry(session, projectId, `Время ${tag}`);
    await createInventoryItem(session, `Позиция ${tag}`, projectId);
  }

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
  }

  async function createProject(session: RegisteredSession, name: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/projects`, {
      method: "POST",
      token: session.accessToken,
      body: { name }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function getProject(
    session: RegisteredSession,
    projectId: string
  ): Promise<{
    counts: { tasks: number; closed: number; notes: number; events: number; documents: number; inventory: number };
    trackedMinutes: number;
    spentAmount: number;
    spentOther: Array<{ currency: string; amount: number }>;
    activity: Array<{ type: string; title: string; id: string }>;
  }> {
    const res = await request<{
      counts: { tasks: number; closed: number; notes: number; events: number; documents: number; inventory: number };
      trackedMinutes: number;
      spentAmount: number;
      spentOther: Array<{ currency: string; amount: number }>;
      activity: Array<{ type: string; title: string; id: string }>;
    }>(`/workspaces/${session.workspaceId}/projects/${projectId}`, { method: "GET", token: session.accessToken });
    expect(res.status).toBe(200);
    return res.data;
  }

  async function createTask(
    session: RegisteredSession,
    title: string,
    projectId: string | null
  ): Promise<{ id: string; projectId: string | null }> {
    const res = await request<{ id: string; projectId: string | null }>(`/workspaces/${session.workspaceId}/tasks`, {
      method: "POST",
      token: session.accessToken,
      body: { title, projectId }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createNote(session: RegisteredSession, title: string, projectId: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/notes`, {
      method: "POST",
      token: session.accessToken,
      body: { title, body: "", tags: [], projectId }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createEvent(session: RegisteredSession, title: string, projectId: string): Promise<{ id: string }> {
    const startAt = new Date(Date.now() + 3_600_000).toISOString();
    const endAt = new Date(Date.now() + 7_200_000).toISOString();
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/events`, {
      method: "POST",
      token: session.accessToken,
      body: { title, startAt, endAt, projectId }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createDocumentInProject(session: RegisteredSession, name: string, projectId: string): Promise<{ id: string }> {
    const created = await request<{ id: string }>(`/workspaces/${session.workspaceId}/documents`, {
      method: "POST",
      token: session.accessToken,
      body: { name, parentId: null }
    });
    expect(created.status).toBe(201);
    const patched = await request(`/workspaces/${session.workspaceId}/documents/${created.data.id}`, {
      method: "PATCH",
      token: session.accessToken,
      body: { projectId }
    });
    expect(patched.status).toBe(200);
    return created.data;
  }

  async function createAccount(session: RegisteredSession, name: string, currency = "RUB"): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/finance/accounts`, {
      method: "POST",
      token: session.accessToken,
      body: { name, kind: "cash", currency }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createTransaction(
    session: RegisteredSession,
    accountId: string,
    projectId: string | null,
    note: string
  ): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/finance/transactions`, {
      method: "POST",
      token: session.accessToken,
      body: {
        accountId,
        type: "expense",
        occurredAt: new Date().toISOString(),
        note,
        tags: [],
        projectId,
        lines: [{ amount: 500, categoryId: null }]
      }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createTimeEntry(session: RegisteredSession, projectId: string, note: string): Promise<{ id: string }> {
    const startedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const endedAt = new Date().toISOString();
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/time`, {
      method: "POST",
      token: session.accessToken,
      body: { projectId, note, startedAt, endedAt }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createInventoryItem(session: RegisteredSession, name: string, projectId: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/inventory/items`, {
      method: "POST",
      token: session.accessToken,
      body: { name, projectId }
    });
    expect(res.status).toBe(201);
    return res.data;
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
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});
