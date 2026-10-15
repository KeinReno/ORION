import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { ContactRemindersService } from "../src/contacts/contact-reminders.service";

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

  type Card = {
    id: string;
    workspaceId: string;
    homeId: string | null;
    kind: string;
    name: string;
    organization: string;
    role: string;
    phone: string;
    email: string;
    phones: Array<{ label: string; value: string }>;
    emails: Array<{ label: string; value: string }>;
    links: Array<{ label: string; value: string }>;
    address: string;
    birthday: string | null;
    tags: string[];
    favorite: boolean;
    contactEveryDays: number | null;
    lastContactedAt: string | null;
    archivedAt: string | null;
    note: string;
  };

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

  it("stores lists, tags, birthday and keeps the primary phone/email in sync", async () => {
    const { call } = await setup("rich");
    const created = await call<Card>("POST", "/contacts", {
      name: "Анна Орлова",
      kind: "person",
      organization: "Альфа",
      phones: [
        { label: "мобильный", value: "+7 900 111-22-33" },
        { label: "", value: "8 (900) 111-22-33" },
        { label: "рабочий", value: "+7 495 000-00-00" }
      ],
      emails: [{ label: "рабочая", value: "anna@example.test" }],
      links: [{ label: "Telegram", value: "@anna" }],
      tags: [" Семья ", "семья", "работа"],
      birthday: "1990-05-17",
      favorite: true,
      contactEveryDays: 30
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      organization: "Альфа",
      phone: "+7 900 111-22-33",
      email: "anna@example.test",
      tags: ["Семья", "работа"],
      birthday: "1990-05-17",
      favorite: true,
      contactEveryDays: 30,
      lastContactedAt: null,
      archivedAt: null
    });
    // The repeated number (written with 8 instead of +7) is dropped.
    expect(created.data.phones.map((p) => p.value)).toEqual(["+7 900 111-22-33", "+7 495 000-00-00"]);
    expect(created.data.links).toEqual([{ label: "Telegram", value: "@anna" }]);

    // A lone legacy primary replaces the list; clearing it empties both.
    const legacy = await call<Card>("PATCH", `/contacts/${created.data.id}`, { phone: "+7 911 000-00-00" });
    expect(legacy.data.phones).toEqual([{ label: "", value: "+7 911 000-00-00" }]);
    const cleared = await call<Card>("PATCH", `/contacts/${created.data.id}`, { phones: [], birthday: null, contactEveryDays: null });
    expect(cleared.data).toMatchObject({ phone: "", phones: [], birthday: null, contactEveryDays: null });

    // Validation: a bad day, a bad cadence, a bad email in the list.
    expect((await call("POST", "/contacts", { name: "X", birthday: "2026-02-30" })).status).toBe(400);
    expect((await call("POST", "/contacts", { name: "X", contactEveryDays: 0 })).status).toBe(400);
    expect((await call("POST", "/contacts", { name: "X", emails: [{ label: "", value: "nope" }] })).status).toBe(400);
  });

  it("archives and restores without losing the contact; Home no longer shows an archived one", async () => {
    const { call } = await setup("archive");
    const home = await call<{ id: string }>("POST", "/homes", { name: "Квартира" });
    const contact = await call<Card>("POST", "/contacts", { name: "Мастер", homeId: home.data.id });
    const archived = await call<Card>("PATCH", `/contacts/${contact.data.id}`, { archived: true });
    expect(archived.data.archivedAt).not.toBeNull();
    expect((await call<Card[]>("GET", "/contacts")).data.map((c) => c.id)).toContain(contact.data.id);
    const overview = await call<{ contacts: unknown[] }>("GET", `/homes/${home.data.id}/overview`);
    expect(overview.data.contacts).toHaveLength(0);
    const restored = await call<Card>("PATCH", `/contacts/${contact.data.id}`, { archived: false });
    expect(restored.data.archivedAt).toBeNull();
  });

  it("keeps a journal and moves lastContactedAt with it", async () => {
    const a = await setup("journal-a");
    const b = await setup("journal-b");
    const contact = await a.call<Card>("POST", "/contacts", { name: "Клиент", contactEveryDays: 14 });
    const earlier = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const later = new Date(Date.now() - 3_600_000).toISOString();

    const first = await a.call<{ id: string }>("POST", `/contacts/${contact.data.id}/interactions`, { kind: "call", note: "обсудили смету", occurredAt: earlier });
    expect(first.status).toBe(201);
    expect((await a.call<Card>("GET", `/contacts/${contact.data.id}`)).data.lastContactedAt).toBe(earlier);
    const second = await a.call<{ id: string }>("POST", `/contacts/${contact.data.id}/interactions`, { kind: "meeting", occurredAt: later });
    expect((await a.call<Card>("GET", `/contacts/${contact.data.id}`)).data.lastContactedAt).toBe(later);
    // A planned (future) entry never counts as «already contacted».
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await a.call("POST", `/contacts/${contact.data.id}/interactions`, { kind: "meeting", occurredAt: future });
    expect((await a.call<Card>("GET", `/contacts/${contact.data.id}`)).data.lastContactedAt).toBe(later);

    const listed = await a.call<Array<{ id: string; kind: string }>>("GET", `/contacts/${contact.data.id}/interactions`);
    expect(listed.data).toHaveLength(3);

    // Removing the latest real entry falls back to the previous one.
    expect((await a.call("DELETE", `/contacts/${contact.data.id}/interactions/${second.data.id}`)).status).toBe(204);
    expect((await a.call<Card>("GET", `/contacts/${contact.data.id}`)).data.lastContactedAt).toBe(earlier);

    // Not reachable from another workspace.
    expect((await b.call("GET", `/contacts/${contact.data.id}/interactions`)).status).toBe(404);
    expect((await b.call("POST", `/contacts/${contact.data.id}/interactions`, { kind: "call" })).status).toBe(404);
    expect((await a.call("DELETE", `/contacts/${contact.data.id}/interactions/not-an-id`)).status).toBe(404);
  });

  it("relates two contacts symmetrically and refuses strangers and itself", async () => {
    const a = await setup("rel-a");
    const b = await setup("rel-b");
    const anna = await a.call<Card>("POST", "/contacts", { name: "Анна" });
    const boris = await a.call<Card>("POST", "/contacts", { name: "Борис" });
    const stranger = await b.call<Card>("POST", "/contacts", { name: "Чужой" });

    const created = await a.call<{ id: string; otherId: string; otherName: string; label: string }>("POST", `/contacts/${anna.data.id}/relations`, { otherId: boris.data.id, label: "супруг(а)" });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ otherId: boris.data.id, otherName: "Борис", label: "супруг(а)" });

    const fromBoris = await a.call<Array<{ otherId: string; otherName: string; label: string }>>("GET", `/contacts/${boris.data.id}/relations`);
    expect(fromBoris.data).toEqual([expect.objectContaining({ otherId: anna.data.id, otherName: "Анна", label: "супруг(а)" })]);

    // The same pair from the other side renames the label instead of duplicating.
    await a.call("POST", `/contacts/${boris.data.id}/relations`, { otherId: anna.data.id, label: "муж" });
    const again = await a.call<Array<{ label: string }>>("GET", `/contacts/${anna.data.id}/relations`);
    expect(again.data).toEqual([expect.objectContaining({ label: "муж" })]);

    expect((await a.call("POST", `/contacts/${anna.data.id}/relations`, { otherId: anna.data.id })).status).toBe(400);
    expect((await a.call("POST", `/contacts/${anna.data.id}/relations`, { otherId: stranger.data.id })).status).toBe(404);
    expect((await b.call("GET", `/contacts/${anna.data.id}/relations`)).status).toBe(404);

    expect((await a.call("DELETE", `/contacts/${anna.data.id}/relations/${created.data.id}`)).status).toBe(204);
    expect((await a.call<unknown[]>("GET", `/contacts/${boris.data.id}/relations`)).data).toEqual([]);
    // Deleting a contact takes its relations with it.
    await a.call("POST", `/contacts/${anna.data.id}/relations`, { otherId: boris.data.id, label: "друг" });
    await a.call("DELETE", `/contacts/${boris.data.id}`);
    expect((await a.call<unknown[]>("GET", `/contacts/${anna.data.id}/relations`)).data).toEqual([]);
  });

  it("applies bulk actions inside the workspace only", async () => {
    const a = await setup("bulk-a");
    const b = await setup("bulk-b");
    const one = await a.call<Card>("POST", "/contacts", { name: "Один", tags: ["семья"] });
    const two = await a.call<Card>("POST", "/contacts", { name: "Два" });
    const foreign = await b.call<Card>("POST", "/contacts", { name: "Чужой" });
    const ids = [one.data.id, two.data.id, foreign.data.id];

    // «Один» already has the tag (so only «Два» changes) and the stranger is untouched.
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "addTag", tag: "Семья" })).data.affected).toBe(1);
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "addTag", tag: "клиенты" })).data.affected).toBe(2);
    expect((await a.call<Card>("GET", `/contacts/${two.data.id}`)).data.tags).toEqual(["Семья", "клиенты"]);
    expect((await b.call<Card>("GET", `/contacts/${foreign.data.id}`)).data.tags).toEqual([]);
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "removeTag", tag: "КЛИЕНТЫ" })).data.affected).toBe(2);
    expect((await a.call("POST", "/contacts/bulk", { ids, action: "addTag" })).status).toBe(400);

    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "favorite" })).data.affected).toBe(2);
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "archive" })).data.affected).toBe(2);
    expect((await a.call<Card>("GET", `/contacts/${one.data.id}`)).data.archivedAt).not.toBeNull();
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "restore" })).data.affected).toBe(2);
    expect((await a.call<{ affected: number }>("POST", "/contacts/bulk", { ids, action: "delete" })).data.affected).toBe(2);
    expect((await b.call("GET", `/contacts/${foreign.data.id}`)).status).toBe(200);
  });

  it("imports rows and skips the ones that look like existing or earlier contacts", async () => {
    const { call } = await setup("import");
    await call("POST", "/contacts", { name: "Иван Петров", phone: "+7 900 123-45-67" });
    const result = await call<{ created: number; skipped: number }>("POST", "/contacts/import", {
      items: [
        { name: "Иван П.", phones: [{ label: "", value: "8 900 123-45-67" }] }, // same phone as existing
        { name: "Мария", emails: [{ label: "", value: "maria@example.test" }] },
        { name: "Маша", emails: [{ label: "", value: "MARIA@example.test" }] }, // same email as the previous row
        { name: "Сергей", tags: ["клиенты"], birthday: "1980-01-02" }
      ]
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ created: 2, skipped: 2 });
    const all = await call<Card[]>("GET", "/contacts");
    expect(all.data.map((c) => c.name).sort()).toEqual(["Иван Петров", "Мария", "Сергей"].sort());

    const forced = await call<{ created: number; skipped: number }>("POST", "/contacts/import", {
      items: [{ name: "Мария", emails: [{ label: "", value: "maria@example.test" }] }],
      skipDuplicates: false
    });
    expect(forced.data).toEqual({ created: 1, skipped: 0 });
    expect((await call("POST", "/contacts/import", { items: [] })).status).toBe(400);
  });

  it("merges contacts: data, journal, relations, links and reminders move to the survivor", async () => {
    const a = await setup("merge-a");
    const b = await setup("merge-b");
    const keep = await a.call<Card>("POST", "/contacts", { name: "Иван Петров", phones: [{ label: "", value: "+7 900 000-00-01" }], tags: ["семья"], note: "первая" });
    const dup = await a.call<Card>("POST", "/contacts", {
      name: "Иван П.",
      role: "сантехник",
      phones: [{ label: "рабочий", value: "+7 900 000-00-02" }],
      tags: ["работа"],
      favorite: true,
      birthday: "1985-03-04",
      note: "вторая"
    });
    const friend = await a.call<Card>("POST", "/contacts", { name: "Друг" });
    const task = await a.call<{ id: string }>("POST", "/tasks", { title: "Позвонить" });
    const stranger = await b.call<Card>("POST", "/contacts", { name: "Чужой" });

    const earlier = new Date(Date.now() - 86_400_000).toISOString();
    await a.call("POST", `/contacts/${dup.data.id}/interactions`, { kind: "call", occurredAt: earlier });
    await a.call("POST", `/contacts/${dup.data.id}/relations`, { otherId: friend.data.id, label: "друг" });
    // Both contacts linked to the same task: the merge must not trip over the unique link.
    await a.call("POST", "/links", { sourceType: "contact", sourceId: keep.data.id, targetType: "task", targetId: task.data.id });
    await a.call("POST", "/links", { sourceType: "contact", sourceId: dup.data.id, targetType: "task", targetId: task.data.id });
    await a.call("POST", "/reminders", { entityType: "contact", entityId: dup.data.id, scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), timezone: "Europe/Moscow" });

    expect((await b.call("POST", `/contacts/${keep.data.id}/merge`, { sourceIds: [stranger.data.id] })).status).toBe(404);
    expect((await a.call("POST", `/contacts/${keep.data.id}/merge`, { sourceIds: [stranger.data.id] })).status).toBe(404);
    expect((await a.call("POST", `/contacts/${keep.data.id}/merge`, { sourceIds: [keep.data.id] })).status).toBe(400);

    const merged = await a.call<Card>("POST", `/contacts/${keep.data.id}/merge`, { sourceIds: [dup.data.id] });
    expect(merged.status).toBe(200);
    expect(merged.data).toMatchObject({
      id: keep.data.id,
      name: "Иван Петров",
      role: "сантехник",
      favorite: true,
      birthday: "1985-03-04",
      tags: ["семья", "работа"],
      note: "первая\n\nвторая",
      lastContactedAt: earlier
    });
    expect(merged.data.phones.map((p) => p.value)).toEqual(["+7 900 000-00-01", "+7 900 000-00-02"]);

    expect((await a.call("GET", `/contacts/${dup.data.id}`)).status).toBe(404);
    expect((await a.call<unknown[]>("GET", `/contacts/${keep.data.id}/interactions`)).data).toHaveLength(1);
    expect((await a.call<Array<{ otherId: string }>>("GET", `/contacts/${keep.data.id}/relations`)).data).toEqual([expect.objectContaining({ otherId: friend.data.id, label: "друг" })]);
    const links = await a.call<{ items: unknown[] }>("GET", `/links?type=task&id=${task.data.id}`);
    expect(links.data.items).toHaveLength(1);
    const reminders = await a.call<Array<{ entityId: string }>>("GET", "/reminders");
    expect(reminders.data.map((r) => r.entityId)).toEqual([keep.data.id]);
  });

  it("a plain phone edit through «Дом» resets the phone list", async () => {
    const { call } = await setup("home-phone");
    const home = await call<{ id: string }>("POST", "/homes", { name: "Дача" });
    const contact = await call<Card>("POST", "/contacts", { name: "Сторож", homeId: home.data.id, phones: [{ label: "а", value: "111" }, { label: "б", value: "2222222" }] });
    await call("PATCH", `/homes/${home.data.id}/contacts/${contact.data.id}`, { phone: "+7 900 000-00-00" });
    const after = await call<Card>("GET", `/contacts/${contact.data.id}`);
    expect(after.data.phone).toBe("+7 900 000-00-00");
    expect(after.data.phones).toEqual([{ label: "", value: "+7 900 000-00-00" }]);
  });

  it("tells about a birthday and a due follow-up once, and not again", async () => {
    const { call } = await setup("reminders");
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const todayMonthDay = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const birthday = await call<Card>("POST", "/contacts", { name: "Именинник", birthday: `1990-${todayMonthDay}` });
    const quiet = await call<Card>("POST", "/contacts", { name: "Без повода" });
    const cadence = await call<Card>("POST", "/contacts", { name: "Давно не общались", contactEveryDays: 1 });

    const service = app.get(ContactRemindersService);
    // Two days later the one-day cadence is overdue; running a tick twice must not repeat anything.
    await service.runCheck(now);
    await service.runCheck(now);
    const later = new Date(now.getTime() + 2 * 86_400_000);
    await service.runCheck(later);
    await service.runCheck(later);

    const notifications = await call<Array<{ kind: string; entityId: string | null; title: string }>>("GET", "/notifications");
    const birthdays = notifications.data.filter((n) => n.kind === "contact_birthday" && n.entityId === birthday.data.id);
    expect(birthdays).toHaveLength(1);
    expect(birthdays[0]?.title).toContain("Именинник");
    const followUps = notifications.data.filter((n) => n.kind === "contact_followup" && n.entityId === cadence.data.id);
    expect(followUps).toHaveLength(1);
    expect(notifications.data.some((n) => n.entityId === quiet.data.id)).toBe(false);
  });
});
