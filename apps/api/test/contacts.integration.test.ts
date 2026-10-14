import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Module «Контакты»: universal contacts over the table «Дом» already uses —
 * CRUD, workspace isolation, an optional home link that a home's own API keeps
 * seeing, global search, entity links and reminders of type "contact", and the
 * module switch (409, data kept, the home block unaffected).
 */
describe("Contacts module", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `contacts-${runId}`;

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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup(name: string) {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const call = <T = unknown>(method: string, path: string, body?: unknown) => request<T>(`/workspaces/${ws}${path}`, { method, token, body });
    return { ws, call };
  }

  type Card = { id: string; workspaceId: string; homeId: string | null; name: string; role: string; phone: string; email: string; note: string };

  it("creates, lists, edits and deletes a contact; rejects a bad email", async () => {
    const { ws, call } = await setup("crud");
    const created = await call<Card>("POST", "/contacts", { name: "Иван Петров", role: "сантехник", phone: "+7 900 123-45-67", email: "ivan@example.test" });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ workspaceId: ws, homeId: null, name: "Иван Петров", note: "" });
    expect((await call("POST", "/contacts", { name: "Без почты", email: "not-an-email" })).status).toBe(400);

    const listed = await call<Card[]>("GET", "/contacts");
    expect(listed.data.map((c) => c.name)).toEqual(["Иван Петров"]);
    const edited = await call<Card>("PATCH", `/contacts/${created.data.id}`, { note: "только по будням", email: "" });
    expect(edited.data).toMatchObject({ note: "только по будням", email: "" });
    expect((await call("DELETE", `/contacts/${created.data.id}`)).status).toBe(204);
    expect((await call("GET", `/contacts/${created.data.id}`)).status).toBe(404);
  });

  it("never crosses workspaces", async () => {
    const a = await setup("iso-a");
    const b = await setup("iso-b");
    const secret = await b.call<Card>("POST", "/contacts", { name: "Чужой" });
    expect((await a.call("GET", `/contacts/${secret.data.id}`)).status).toBe(404);
    expect((await a.call("PATCH", `/contacts/${secret.data.id}`, { name: "Взлом" })).status).toBe(404);
    expect((await a.call("DELETE", `/contacts/${secret.data.id}`)).status).toBe(404);
    expect((await a.call<Card[]>("GET", "/contacts")).data).toEqual([]);
    const home = await b.call<{ id: string }>("POST", "/homes", { name: "Чужой дом" });
    expect((await a.call("POST", "/contacts", { name: "Сосед", homeId: home.data.id })).status).toBe(400);
  });

  it("a home's contacts are ordinary contacts; Home keeps its own scoped view", async () => {
    const { call } = await setup("home");
    const home = await call<{ id: string }>("POST", "/homes", { name: "Квартира" });
    const fromHome = await call<{ id: string }>("POST", `/homes/${home.data.id}/contacts`, { name: "ООО УК", role: "управляющая компания" });
    const universal = await call<Card>("POST", "/contacts", { name: "Бухгалтер" });
    const attached = await call<Card>("POST", "/contacts", { name: "Электрик", homeId: home.data.id });
    expect(attached.data.homeId).toBe(home.data.id);

    const all = await call<Card[]>("GET", "/contacts");
    expect(all.data.map((c) => c.name).sort()).toEqual(["ООО УК", "Бухгалтер", "Электрик"].sort());
    expect(all.data.find((c) => c.id === fromHome.data.id)?.homeId).toBe(home.data.id);

    const overview = await call<{ contacts: Array<{ id: string }> }>("GET", `/homes/${home.data.id}/overview`);
    expect(overview.data.contacts.map((c) => c.id).sort()).toEqual([fromHome.data.id, attached.data.id].sort());
    // Home's endpoints stay scoped: a contact without this home is not editable through it.
    expect((await call("PATCH", `/homes/${home.data.id}/contacts/${universal.data.id}`, { phone: "1" })).status).toBe(404);
  });

  it("is searchable and linkable as type contact, with reminders", async () => {
    const { call } = await setup("links");
    const contact = await call<Card>("POST", "/contacts", { name: "Мария Сидорова", role: "заказчик", email: "maria@example.test" });
    const task = await call<{ id: string }>("POST", "/tasks", { title: "Отправить смету" });

    const hits = await call<Array<{ type: string; id: string; title: string }>>("GET", `/search?q=${encodeURIComponent("сидоров")}`);
    expect(hits.data).toContainEqual(expect.objectContaining({ type: "contact", id: contact.data.id, title: "Мария Сидорова" }));

    const link = await call("POST", "/links", { sourceType: "contact", sourceId: contact.data.id, targetType: "task", targetId: task.data.id });
    expect(link.status).toBe(201);
    const links = await call<{ items: unknown[] }>("GET", `/links?type=task&id=${task.data.id}`);
    expect(JSON.stringify(links.data)).toContain("Мария Сидорова");

    const reminder = await call("POST", "/reminders", {
      entityType: "contact",
      entityId: contact.data.id,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      timezone: "Europe/Moscow"
    });
    expect(reminder.status).toBe(201);
  });

  it("switching the module off answers 409 and keeps data; the home block keeps working", async () => {
    const { call } = await setup("gate");
    const home = await call<{ id: string }>("POST", "/homes", { name: "Дача" });
    const contact = await call<Card>("POST", "/contacts", { name: "Сторож", homeId: home.data.id });
    expect((await call("PATCH", "/modules/contacts", { enabled: false })).status).toBe(200);
    expect((await call("GET", "/contacts")).status).toBe(409);
    const overview = await call<{ contacts: Array<{ id: string }> }>("GET", `/homes/${home.data.id}/overview`);
    expect(overview.data.contacts.map((c) => c.id)).toEqual([contact.data.id]);
    expect((await call("PATCH", `/homes/${home.data.id}/contacts/${contact.data.id}`, { phone: "+7 900 000-00-00" })).status).toBe(200);
    expect((await call("PATCH", "/modules/contacts", { enabled: true })).status).toBe(200);
    expect((await call<Card>("GET", `/contacts/${contact.data.id}`)).data.phone).toBe("+7 900 000-00-00");
  });
});
