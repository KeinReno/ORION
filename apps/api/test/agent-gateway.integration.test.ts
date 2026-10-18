import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { parseOrionLink, type AgentCaptureResult, type AgentGatewayContext, type AgentLink, type AgentSearchResponse } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Session {
  accessToken: string;
  email: string;
  workspaceId: string;
}

/** Agent Gateway (TZ-02): context → capture → link → url, scopes, idempotency, module switches, isolation, audit. */
describe("Agent Gateway", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `gateway-${runId}`;

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

  const BASE_SCOPES = ["projects:read", "notes:read", "notes:write", "tasks:read", "tasks:write", "events:write", "links:write"];

  it("контрольный сценарий: get_context → найти проект → capture заметки → link → рабочий url (≤ 6 вызовов)", async () => {
    const alice = await register("alice");
    const project = await createProject(alice, "Ремонт кухни");
    const agent = await issue(alice, BASE_SCOPES);
    let calls = 0;
    const call = async <T,>(method: string, path: string, body?: unknown) => {
      calls += 1;
      return request<T>(path, { method, token: agent.secret, body });
    };

    const context = await call<AgentGatewayContext>("GET", "/ai/v1/context");
    expect(context.status).toBe(200);
    expect(context.data.apiVersion).toBe("1");
    expect(context.data.workspace.id).toBe(alice.workspaceId);
    const found = context.data.projects?.find((p) => p.name === "Ремонт кухни");
    expect(found?.id).toBe(project.id);
    expect(context.data.capabilities).toEqual(expect.arrayContaining(["capture", "search", "links"]));
    expect(context.data.capture.hints.find((h) => h.hint === "idea")?.available).toBe(true);
    expect(context.data.capture.hints.find((h) => h.hint === "event")?.available).toBe(true);

    const captured = await call<AgentCaptureResult>("POST", "/ai/v1/capture", {
      text: "Сделать подсветку под шкафами.\nДобавить розетку у раковины.",
      title: "Идея: подсветка",
      hint: "idea",
      projectId: project.id,
      source: "тест Gateway",
      idempotencyKey: "scenario-1"
    });
    expect(captured.status).toBe(201);
    expect(captured.data).toMatchObject({ status: "created", kind: "note", workspaceId: alice.workspaceId, projectId: project.id, deduplicated: false });

    const linked = await call<AgentLink>("POST", "/ai/v1/links", { sourceType: "note", sourceId: captured.data.id, targetType: "project", targetId: project.id });
    expect(linked.status).toBe(201);
    expect(linked.data.kind).toBe("related_to");
    expect(calls).toBeLessThanOrEqual(6);

    // The url resolves to the real object: parseable, same workspace, and the note is what the human sees.
    expect(parseOrionLink(captured.data.url)).toEqual({ type: "note", id: captured.data.id, workspaceId: alice.workspaceId });
    const note = await request<{ title: string; body: string; tags: string[]; createdByAgent?: string; projectId: string }>(`/workspaces/${alice.workspaceId}/notes/${captured.data.id}`, { method: "GET", token: alice.accessToken });
    expect(note.data).toMatchObject({ title: "Идея: подсветка", tags: ["идея"], projectId: project.id, createdByAgent: "Claude (тест Gateway)" });
    expect(note.data.body).toContain("розетку");

    const links = await request<{ items: Array<{ targetId: string }> }>(`/workspaces/${alice.workspaceId}/links?type=note&id=${captured.data.id}`, { method: "GET", token: alice.accessToken });
    expect(links.data.items.map((l) => l.targetId)).toContain(project.id);
  });

  it("без hint — во «Входящие» с пометкой агента; префикс /task — задача", async () => {
    const alice = await register("inbox");
    const agent = await issue(alice, ["notes:write", "tasks:write"]);

    const plain = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Что-то про отпуск в ноябре" } });
    expect(plain.status).toBe(201);
    expect(plain.data).toMatchObject({ status: "inbox", kind: "inbox" });
    expect(plain.data.reason).toBeTruthy();
    expect(parseOrionLink(plain.data.url)?.type).toBe("inbox");

    const inbox = await request<{ items: Array<{ id: string; title: string; kind: string; createdByAgent: string | null; processedAt: string | null }> }>(`/workspaces/${alice.workspaceId}/inbox`, { method: "GET", token: alice.accessToken });
    const item = inbox.data.items.find((i) => i.id === plain.data.id);
    expect(item).toMatchObject({ title: "Что-то про отпуск в ноябре", kind: "inbox", createdByAgent: "Claude", processedAt: null });

    // Same rule as the quick-capture field: an explicit /task prefix is a destination, not a guess.
    const prefixed = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "/task Купить хлеб" } });
    expect(prefixed.data).toMatchObject({ status: "created", kind: "task" });
    const tasks = await request<Array<{ id: string; title: string }>>(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.find((t) => t.id === prefixed.data.id)?.title).toBe("Купить хлеб");
  });

  it("idempotencyKey: повтор и параллельные гонки дают одну запись", async () => {
    const alice = await register("idem");
    const agent = await issue(alice, ["notes:write"]);
    const body = { text: "Однажды записано", hint: "note", idempotencyKey: "same-key" };
    const first = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body });
    const again = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body });
    expect(first.data.deduplicated).toBe(false);
    expect(again.status).toBe(201);
    expect(again.data).toMatchObject({ id: first.data.id, deduplicated: true, kind: "note" });

    const race = await Promise.all(
      Array.from({ length: 6 }, () => request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Гонка", hint: "note", idempotencyKey: "race-key" } }))
    );
    expect(new Set(race.map((r) => r.data.id)).size).toBe(1);
    expect(race.filter((r) => !r.data.deduplicated)).toHaveLength(1);

    const notes = await request<Array<{ id: string }>>(`/workspaces/${alice.workspaceId}/notes`, { method: "GET", token: alice.accessToken });
    expect(notes.data.filter((n) => n.id === first.data.id || n.id === race[0]!.data.id)).toHaveLength(2);
    // A different token with the same key is a different caller: its own record.
    const other = await issue(alice, ["notes:write"]);
    const theirs = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: other.secret, body });
    expect(theirs.data.id).not.toBe(first.data.id);
    expect(theirs.data.deduplicated).toBe(false);
  });

  it("чужой projectId → 400; hint без нужного dueAt → 400; ничего не создаётся", async () => {
    const alice = await register("owner");
    const mallory = await register("mallory");
    const foreignProject = await createProject(mallory, "Секретный проект");
    const agent = await issue(alice, ["notes:write", "tasks:write", "events:write", "projects:read"]);

    const foreign = await request<{ message: string }>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "x", hint: "note", projectId: foreignProject.id, idempotencyKey: "k-foreign" } });
    expect(foreign.status).toBe(400);
    expect(JSON.stringify(foreign.data)).not.toContain("Секретный");
    // The failed call rolled its idempotency claim back too: the key is still free.
    const retry = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "x", hint: "note", idempotencyKey: "k-foreign" } });
    expect(retry.status).toBe(201);

    expect((await request("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "позвонить", hint: "reminder" } })).status).toBe(400);
    expect((await request("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "встреча", hint: "event" } })).status).toBe(400);

    const reminder = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Позвонить в банк", hint: "reminder", dueAt: "2026-12-01T09:00:00.000Z" } });
    expect(reminder.data).toMatchObject({ status: "created", kind: "task" });
    const tasks = await request<Array<{ id: string; dueAt: string | null }>>(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.find((t) => t.id === reminder.data.id)?.dueAt).toBe("2026-12-01T09:00:00.000Z");

    const event = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Встреча с подрядчиком", hint: "event", dueAt: "2026-12-02T10:00:00.000Z" } });
    expect(event.data.kind).toBe("event");
    const window = await request<Array<{ id: string; startAt: string; endAt: string }>>(`/workspaces/${alice.workspaceId}/events?from=2026-12-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z`, { method: "GET", token: alice.accessToken });
    const created = window.data.find((e) => e.id === event.data.id);
    expect(new Date(created!.endAt).getTime() - new Date(created!.startAt).getTime()).toBe(30 * 60_000);
  });

  it("нет разрешения → 403 и запись в журнале; токен не попадает в журнал", async () => {
    const alice = await register("scopes");
    const reader = await issue(alice, ["notes:read", "projects:read"]);

    const denied = await request("/ai/v1/capture", { method: "POST", token: reader.secret, body: { text: "x", hint: "note" } });
    expect(denied.status).toBe(403);
    const noWriteAtAll = await request("/ai/v1/capture", { method: "POST", token: reader.secret, body: { text: "x" } });
    expect(noWriteAtAll.status).toBe(403);
    const noTasks = await issue(alice, ["notes:write"]);
    expect((await request("/ai/v1/capture", { method: "POST", token: noTasks.secret, body: { text: "x", hint: "task" } })).status).toBe(403);
    expect((await request("/ai/v1/links", { method: "POST", token: reader.secret, body: { sourceType: "note", sourceId: "a", targetType: "project", targetId: "b" } })).status).toBe(403);
    expect((await request("/ai/v1/capture", { method: "POST", token: noTasks.secret, body: { text: "x", hint: "note", links: [{ type: "project", id: "p" }] } })).status).toBe(403);

    const audit = await request<Array<{ action: string; status: number }>>(`/workspaces/${alice.workspaceId}/agent-tokens/audit`, { method: "GET", token: alice.accessToken });
    const actions = audit.data.map((e) => `${e.action}:${e.status}`);
    expect(actions).toContain("capture:403");
    expect(actions).toContain("links.create:403");
    expect(JSON.stringify(audit.data)).not.toContain(reader.secret);
    expect(JSON.stringify(audit.data)).not.toContain(noTasks.secret);
  });

  it("выключенный модуль → 409; остальные работают; в context он не назван", async () => {
    const alice = await register("modules");
    const agent = await issue(alice, ["notes:read", "notes:write", "tasks:write"]);
    const off = await request(`/workspaces/${alice.workspaceId}/modules/notes`, { method: "PATCH", token: alice.accessToken, body: { enabled: false, confirm: true } });
    expect(off.status).toBeLessThan(300);

    const note = await request("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "x", hint: "note" } });
    expect(note.status).toBe(409);
    const task = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "ещё работает", hint: "task" } });
    expect(task.status).toBe(201);

    const context = await request<AgentGatewayContext>("/ai/v1/context", { method: "GET", token: agent.secret });
    expect(context.data.modules.map((m) => m.id)).toEqual(["tasks"]);
    expect(context.data.capture.hints.find((h) => h.hint === "note")?.available).toBe(false);
    expect(context.data.projects).toBeNull();

    const audit = await request<Array<{ action: string; status: number }>>(`/workspaces/${alice.workspaceId}/agent-tokens/audit`, { method: "GET", token: alice.accessToken });
    expect(audit.data.map((e) => `${e.action}:${e.status}`)).toContain("capture:409");
  });

  it("поиск видит только типы, на чтение которых есть разрешение; чужое пространство невидимо", async () => {
    const alice = await register("search");
    const mallory = await register("search2");
    const needle = `Квазар${runId.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
    const writer = await issue(alice, ["notes:write", "tasks:write"]);
    const note = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: writer.secret, body: { text: `${needle} заметка`, hint: "note" } });
    const task = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: writer.secret, body: { text: `${needle} задача`, hint: "task" } });
    await request("/ai/v1/capture", { method: "POST", token: (await issue(mallory, ["notes:write"])).secret, body: { text: `${needle} чужая`, hint: "note" } });

    const notesOnly = await issue(alice, ["notes:read"]);
    const found = await request<AgentSearchResponse>(`/ai/v1/search?q=${encodeURIComponent(needle)}`, { method: "GET", token: notesOnly.secret });
    expect(found.status).toBe(200);
    expect(found.data.searched).toEqual(["note"]);
    expect(found.data.results.map((r) => r.id)).toEqual([note.data.id]);
    expect(found.data.results[0]).toMatchObject({ type: "note", url: expect.stringMatching(/^orion:\/\/open\?/) });
    expect(JSON.stringify(found.data)).not.toContain(task.data.id);

    const both = await issue(alice, ["notes:read", "tasks:read"]);
    const wide = await request<AgentSearchResponse>(`/ai/v1/search?q=${encodeURIComponent(needle)}`, { method: "GET", token: both.secret });
    expect(wide.data.results.map((r) => r.id).sort()).toEqual([note.data.id, task.data.id].sort());

    expect((await request("/ai/v1/search?q=a", { method: "GET", token: both.secret })).status).toBe(400);
    expect((await request(`/ai/v1/search?q=${needle}`, { method: "GET", token: writer.secret })).status).toBe(200); // write implies the type is visible
    const nothing = await issue(alice, ["agents:message"]);
    expect((await request(`/ai/v1/search?q=${needle}`, { method: "GET", token: nothing.secret })).status).toBe(403);
  });

  it("связи: чужой объект → 404, повтор → 400, снятие работает, без обоих типов → 403", async () => {
    const alice = await register("links");
    const mallory = await register("links2");
    const foreignProject = await createProject(mallory, "Чужой");
    const project = await createProject(alice, "Свой");
    const agent = await issue(alice, ["projects:read", "notes:write", "links:write"]);
    const note = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Материал", hint: "note", links: [{ type: "project", id: project.id }] } });
    expect(note.data.linked).toBe(1);

    const link = (targetId: string) => request<AgentLink>("/ai/v1/links", { method: "POST", token: agent.secret, body: { sourceType: "note", sourceId: note.data.id, targetType: "project", targetId } });
    expect((await link(foreignProject.id)).status).toBe(404);
    const duplicate = await link(project.id);
    expect(duplicate.status).toBe(400);

    const second = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "Вторая", hint: "note" } });
    const created = await request<AgentLink>("/ai/v1/links", { method: "POST", token: agent.secret, body: { sourceType: "note", sourceId: second.data.id, targetType: "project", targetId: project.id } });
    expect(created.status).toBe(201);
    expect((await request("/ai/v1/links/" + created.data.id, { method: "DELETE", token: agent.secret })).status).toBe(204);
    expect((await request("/ai/v1/links/" + created.data.id, { method: "DELETE", token: agent.secret })).status).toBe(404);

    // A task endpoint the token has no scope for is not linkable (and its existence is not confirmed).
    const task = await request<AgentCaptureResult>("/ai/v1/capture", { method: "POST", token: (await issue(alice, ["tasks:write"])).secret, body: { text: "Задача", hint: "task" } });
    const toTask = await request("/ai/v1/links", { method: "POST", token: agent.secret, body: { sourceType: "note", sourceId: note.data.id, targetType: "task", targetId: task.data.id } });
    expect(toTask.status).toBe(403);
    // Links on an Inbox entry are refused rather than dropped.
    const inboxLinks = await request("/ai/v1/capture", { method: "POST", token: agent.secret, body: { text: "без hint", links: [{ type: "project", id: project.id }] } });
    expect(inboxLinks.status).toBe(400);
  });

  it("руководство: Markdown, без токена нельзя, без утечки секрета; connection-info доступен только участнику", async () => {
    const alice = await register("manual");
    const outsider = await register("manual2");
    const agent = await issue(alice, ["notes:read"]);

    const manual = await fetch(`${baseUrl}/ai/v1/manual`, { headers: { Authorization: `Bearer ${agent.secret}` } });
    expect(manual.status).toBe(200);
    expect(manual.headers.get("content-type")).toContain("text/markdown");
    const text = await manual.text();
    expect(text).toContain("orion_capture");
    expect(text).not.toContain(agent.secret);
    expect((await fetch(`${baseUrl}/ai/v1/manual`)).status).toBe(401);

    const info = await request<{ bridgeEnabled: boolean; mode: string; apiUrl: string | null; launcher: string }>(`/workspaces/${alice.workspaceId}/agent-connection`, { method: "GET", token: alice.accessToken });
    expect(info.status).toBe(200);
    expect(info.data.bridgeEnabled).toBe(true);
    expect(info.data.mode).toBe("local");
    expect((await request(`/workspaces/${alice.workspaceId}/agent-connection`, { method: "GET", token: outsider.accessToken })).status).toBe(403);
  });

  async function issue(owner: Session, scopes: string[]): Promise<{ id: string; secret: string }> {
    const created = await request<{ id: string; secret: string }>(`/workspaces/${owner.workspaceId}/agent-tokens`, {
      method: "POST",
      token: owner.accessToken,
      body: { name: "Claude", scopes, expiresInDays: 30 }
    });
    expect(created.status).toBe(201);
    return created.data;
  }

  async function createProject(owner: Session, name: string): Promise<{ id: string }> {
    const response = await request<{ id: string }>(`/workspaces/${owner.workspaceId}/projects`, { method: "POST", token: owner.accessToken, body: { name } });
    expect(response.status).toBe(201);
    return response.data;
  }

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string }>("/auth/register", { method: "POST", body: { email, password: "integration-password-123", name } });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, email, workspaceId: workspaces.data[0]!.id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});
