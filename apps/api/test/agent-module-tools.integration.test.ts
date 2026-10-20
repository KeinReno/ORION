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
    const issued = await call(`/workspaces/${ws}/agent-tokens`, "POST", human, { name: "Странный", modulePermissions: ["health.record.read"], expiresInDays: 7 });
    expect(issued.status).toBe(400);
  });
});
