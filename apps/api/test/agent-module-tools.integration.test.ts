import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Agent tools of the core modules (G13): habits, lists, time, contacts, documents, finance (read), inventory. Against a real
 * API: a permission per module, read vs write by mode, a module switched off, no undoing a habit mark, the journal.
 */
describe("Agent tools of the core modules", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const emailPrefix = `agent-modules-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: [...new Set(memberships.map((m) => m.workspaceId))] } } });
      });
    }
    await app?.close();
  });

  async function call<T = unknown>(path: string, method = "GET", token?: string, body?: unknown): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  const ALL = [
    "habits.habit.read",
    "habits.habit.update",
    "lists.list.read",
    "lists.list.update",
    "time.entry.read",
    "contacts.contact.read",
    "documents.document.read",
    "finance.transaction.read",
    "inventory.item.read"
  ];

  async function setup(name: string) {
    const registered = await call<{ accessToken: string }>("/auth/register", "POST", undefined, {
      email: `${emailPrefix}-${name}@example.test`,
      password: "integration-password-123",
      name
    });
    const human = registered.data.accessToken;
    const ws = (await call<Array<{ id: string }>>("/workspaces/me", "GET", human)).data[0]!.id;
    const agentToken = async (modulePermissions: string[], mode = "assistant"): Promise<string> => {
      const issued = await call<{ secret: string }>(`/workspaces/${ws}/agent-tokens`, "POST", human, { name: `Агент ${mode}`, modulePermissions, mode, expiresInDays: 7 });
      expect(issued.status, JSON.stringify(issued.data)).toBe(201);
      return issued.data.secret;
    };
    return { human, ws, agentToken };
  }

  it("reads and adds through the module tools with the matching permissions", async () => {
    const { human, ws, agentToken } = await setup("reader");
    const habit = (await call<{ id: string }>(`/workspaces/${ws}/habits`, "POST", human, { name: "Зарядка" })).data;
    const list = (await call<{ id: string }>(`/workspaces/${ws}/lists`, "POST", human, { name: "Покупки" })).data;
    await call(`/workspaces/${ws}/contacts`, "POST", human, { name: "Анна Петрова" });
    await call(`/workspaces/${ws}/contacts`, "POST", human, { name: "Борис" });
    const agent = await agentToken(ALL);

    const habits = await call<Array<{ id: string; doneToday: boolean }>>("/ai/v1/habits", "GET", agent);
    expect(habits.status).toBe(200);
    expect(habits.data.find((item) => item.id === habit.id)?.doneToday).toBe(false);
    const marked = await call<{ done: boolean; name: string }>(`/ai/v1/habits/${habit.id}/done`, "POST", agent, {});
    expect(marked.data).toMatchObject({ done: true, name: "Зарядка" });
    // Marking again never takes the mark back.
    expect((await call<{ done: boolean }>(`/ai/v1/habits/${habit.id}/done`, "POST", agent, {})).data.done).toBe(true);
    expect((await call<Array<{ id: string; doneToday: boolean }>>("/ai/v1/habits", "GET", agent)).data.find((item) => item.id === habit.id)?.doneToday).toBe(true);

    const added = await call<Array<{ label: string; quantity: number | null; unit: string | null }>>(`/ai/v1/lists/${list.id}/items`, "POST", agent, { text: "Молоко, 2 л\nХлеб" });
    expect(added.status).toBe(201);
    expect(added.data.map((item) => item.label)).toEqual(["Молоко", "Хлеб"]);
    expect(added.data[0]).toMatchObject({ quantity: 2, unit: "л" });
    const lists = await call<Array<{ id: string; items: unknown[] }>>("/ai/v1/lists", "GET", agent);
    expect(lists.data.find((item) => item.id === list.id)?.items).toHaveLength(2);

    const contacts = await call<Array<{ name: string }>>("/ai/v1/contacts?query=анна", "GET", agent);
    expect(contacts.data.map((card) => card.name)).toEqual(["Анна Петрова"]);
    expect((await call("/ai/v1/time/summary", "GET", agent)).status).toBe(200);
    expect((await call<unknown[]>("/ai/v1/documents", "GET", agent)).status).toBe(200);
    expect((await call("/ai/v1/documents/nope/text", "GET", agent)).status).toBe(404);
    expect((await call("/ai/v1/finance/accounts", "GET", agent)).status).toBe(200);
    expect((await call("/ai/v1/finance/transactions", "GET", agent)).status).toBe(200);
    expect((await call("/ai/v1/inventory", "GET", agent)).status).toBe(200);

    const audit = await call<Array<{ action: string; module: string | null; summary: string | null; status: number }>>(`/workspaces/${ws}/agent-tokens/audit`, "GET", human);
    expect(audit.data.some((row) => row.action === "orion_habits_mark_done" && row.module === "habits" && row.summary === "Отметил привычку «Зарядка»")).toBe(true);
    expect(audit.data.some((row) => row.action === "orion_lists_add_items" && row.summary === "Добавил в список пунктов: 2")).toBe(true);
  });

  it("refuses without the permission, writes for an observer, and while the module is off", async () => {
    const { human, ws, agentToken } = await setup("refused");
    const habit = (await call<{ id: string }>(`/workspaces/${ws}/habits`, "POST", human, { name: "Чтение" })).data;

    const listsOnly = await agentToken(["lists.list.read"]);
    expect((await call("/ai/v1/habits", "GET", listsOnly)).status).toBe(403);
    expect((await call("/ai/v1/finance/accounts", "GET", listsOnly)).status).toBe(403);

    const observer = await agentToken(["habits.habit.read", "habits.habit.update"], "observer");
    expect((await call("/ai/v1/habits", "GET", observer)).status).toBe(200);
    expect((await call(`/ai/v1/habits/${habit.id}/done`, "POST", observer, {})).status).toBe(403);

    const reader = await agentToken(["habits.habit.read"]);
    expect((await call(`/workspaces/${ws}/modules/habits`, "PATCH", human, { enabled: false, confirm: true })).status).toBe(200);
    expect((await call("/ai/v1/habits", "GET", reader)).status).toBe(409);
  });

  it("refuses to issue a token with a permission no tool uses", async () => {
    const { human, ws } = await setup("unknown");
    const issued = await call(`/workspaces/${ws}/agent-tokens`, "POST", human, { name: "Странный", modulePermissions: ["markets.trade.read"], expiresInDays: 7 });
    expect(issued.status).toBe(400);
  });

  it("changes: an assistant files a request applied on approval, a manager changes at once, deletion is always a request", async () => {
    const { human, ws, agentToken } = await setup("changer");
    const habit = (await call<{ id: string }>(`/workspaces/${ws}/habits`, "POST", human, { name: "Зарядка" })).data;
    const perms = ["habits.habit.read", "habits.habit.update", "habits.habit.delete"];

    const assistant = await agentToken(perms, "assistant");
    const proposed = await call<{ proposed: boolean; proposal: { id: string; targetTitle: string; diff: Array<{ field: string; before: string; after: string }> } }>(`/ai/v1/habits/${habit.id}`, "PATCH", assistant, { name: "Утренняя зарядка" });
    expect(proposed.status).toBe(202);
    expect(proposed.data.proposal.targetTitle).toBe("привычка: Зарядка");
    expect(proposed.data.proposal.diff).toEqual([{ field: "name", label: "Название", before: "Зарядка", after: "Утренняя зарядка" }]);
    expect((await call<Array<{ id: string; name: string }>>(`/workspaces/${ws}/habits`, "GET", human)).data.find((item) => item.id === habit.id)?.name).toBe("Зарядка");
    const approved = await call<{ status: string }>(`/workspaces/${ws}/agent-tokens/proposals/${proposed.data.proposal.id}/approve`, "POST", human, {});
    expect(approved.data.status).toBe("approved");
    expect((await call<Array<{ id: string; name: string }>>(`/workspaces/${ws}/habits`, "GET", human)).data.find((item) => item.id === habit.id)?.name).toBe("Утренняя зарядка");

    const manager = await agentToken(perms, "manager");
    const direct = await call<{ proposed: boolean }>(`/ai/v1/habits/${habit.id}`, "PATCH", manager, { note: "10 минут" });
    expect(direct.status).toBe(200);
    expect(direct.data.proposed).toBe(false);

    const deletion = await call<{ proposed: boolean }>(`/ai/v1/habits/${habit.id}`, "DELETE", manager, { reason: "не нужна" });
    expect(deletion.status).toBe(202);
    expect(deletion.data.proposed).toBe(true);
    // The assistant chat's tokens forbid deletion outright.
    const noDelete = await call<{ secret: string }>(`/workspaces/${ws}/agent-tokens`, "POST", human, { name: "Без удаления", modulePermissions: perms, mode: "manager", forbidden: ["delete"], expiresInDays: 7 });
    expect((await call(`/ai/v1/habits/${habit.id}`, "DELETE", noDelete.data.secret, {})).status).toBe(403);
  });

  it("health and the pet diary: an agent records with the human's rights", async () => {
    const { human, ws, agentToken } = await setup("health");
    // «Здоровье» is off until a human switches it on.
    expect((await call(`/workspaces/${ws}/modules/health`, "PATCH", human, { enabled: true })).status).toBe(200);
    const subject = (await call<{ id: string }>(`/workspaces/${ws}/health/subjects`, "POST", human, { kind: "member", name: "Я" })).data;
    const pet = (await call<{ id: string }>(`/workspaces/${ws}/pet-care/pets`, "POST", human, { name: "Мурчик", species: "cat" })).data;
    const agent = await agentToken(["health.record.read", "health.record.create", "pet-care.pet.read", "pet-care.pet.create"]);

    const overview = await call<{ subjects: Array<{ id: string }> }>("/ai/v1/health", "GET", agent);
    expect(overview.data.subjects.map((item) => item.id)).toContain(subject.id);
    expect((await call(`/ai/v1/health/${subject.id}/measurements`, "POST", agent, { kind: "pulse", value: 72 })).status).toBe(201);
    expect((await call<Array<{ value: number }>>(`/ai/v1/health/${subject.id}/measurements`, "GET", agent)).data.map((item) => item.value)).toEqual([72]);
    expect((await call(`/ai/v1/health/${subject.id}/symptoms`, "POST", agent, { name: "Головная боль", severity: 4 })).status).toBe(201);

    const day = "2026-10-20";
    expect((await call(`/ai/v1/pet-care/pets/${pet.id}/days/${day}`, "POST", agent, { vomitingCount: 1, note: "Утром" })).status).toBe(200);
    const second = await call<{ vomitingCount: number; note: string; appetite: string }>(`/ai/v1/pet-care/pets/${pet.id}/days/${day}`, "POST", agent, { appetite: "reduced", vomitingCount: 2, note: "Вечером" });
    expect(second.data).toMatchObject({ vomitingCount: 2, appetite: "reduced", note: "Утром" + String.fromCharCode(10) + "Вечером" });
    const diary = await call<{ days: unknown[]; alerts: unknown[] }>(`/ai/v1/pet-care/pets/${pet.id}/days?from=${day}&to=${day}&today=${day}`, "GET", agent);
    expect(diary.data.days).toHaveLength(1);
  });

  it("a file in the assistant's inbox folder is moved at once even for an assistant token", async () => {
    const { human, ws, agentToken } = await setup("inbox");
    const inbox = (await call<{ id: string }>(`/workspaces/${ws}/documents`, "POST", human, { name: "Ассистент — входящие" })).data;
    const sent = (await call<{ id: string }>(`/workspaces/${ws}/documents`, "POST", human, { name: "Сканы", parentId: inbox.id })).data;
    const elsewhere = (await call<{ id: string }>(`/workspaces/${ws}/documents`, "POST", human, { name: "Архив" })).data;
    const assistant = await agentToken(["documents.document.read", "documents.document.update"]);
    expect((await call(`/ai/v1/documents/${sent.id}`, "PATCH", assistant, { parentId: elsewhere.id })).status).toBe(200);
    // Outside the inbox the same move is a request.
    expect((await call(`/ai/v1/documents/${sent.id}`, "PATCH", assistant, { name: "Сканы 2026" })).status).toBe(202);
  });
});
