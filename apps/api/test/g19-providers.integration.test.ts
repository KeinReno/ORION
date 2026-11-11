import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

import { TasksSearchProvider } from "../src/tasks/tasks-search.provider";
import { SearchProviderRegistry } from "../src/search/search-provider.registry";
import { InboxTargetRegistry } from "../src/inbox/inbox-target.registry";
interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

/**
 * G19: поиск и разбор входящих идут через реестры провайдеров/целей, зарегистрированные самими модулями.
 * Проверяем реестр, паритет выдачи и то, что выключенный модуль не опрашивается (провайдер не вызывается).
 */
describe("G19: search providers and inbox targets", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `g19-providers-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    expect(workspaces.data).toHaveLength(1);
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

  const term = `зебралис${runId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

  it("registers a provider per searchable type and a target per inbox kind", () => {
    const types = app.get(SearchProviderRegistry).list().map((provider) => provider.entityType);
    expect(types).toEqual(["project", "task", "note", "event", "document", "transaction", "contact", "list", "goal", "account", "savings_goal", "knowledge_item"]);
    const targets = app.get(InboxTargetRegistry);
    expect(["task", "note", "event"].map((kind) => targets.get(kind)?.kind)).toEqual(["task", "note", "event"]);
  });

  it("skips the provider of a disabled module and keeps searching the rest", async () => {
    const s = await register("search");
    const auth = { token: s.accessToken };
    const base = `/workspaces/${s.workspaceId}`;
    const task = await request<{ id: string }>(`${base}/tasks`, { method: "POST", ...auth, body: { title: `Задача ${term}` } });
    const note = await request<{ id: string }>(`${base}/notes`, { method: "POST", ...auth, body: { title: `Заметка ${term}`, body: "" } });
    expect(task.status, JSON.stringify(task.data)).toBe(201);
    expect(note.status, JSON.stringify(note.data)).toBe(201);

    const search = vi.spyOn(app.get(TasksSearchProvider), "search");
    const before = await request<Array<{ id: string; type: string; title: string; subtitle: string; updatedAt: string }>>(`${base}/search?q=${term}`, { method: "GET", ...auth });
    expect(before.status).toBe(200);
    expect(before.data.map((r) => r.type).sort()).toEqual(["note", "task"]);
    expect(before.data.find((r) => r.type === "task")).toMatchObject({ id: task.data.id, title: `Задача ${term}`, subtitle: "К выполнению" });
    expect(search).toHaveBeenCalledTimes(1);

    const off = await request(`${base}/modules/tasks`, { method: "PATCH", ...auth, body: { enabled: false, confirm: true } });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    search.mockClear();
    const after = await request<Array<{ type: string }>>(`${base}/search?q=${term}`, { method: "GET", ...auth });
    expect(after.status).toBe(200);
    expect(after.data.map((r) => r.type)).toEqual(["note"]);
    expect(search).not.toHaveBeenCalled();
    search.mockRestore();
  });

  it("still processes inbox items into enabled targets and refuses a disabled one", async () => {
    const s = await register("inbox");
    const auth = { token: s.accessToken };
    const base = `/workspaces/${s.workspaceId}`;
    const capture = async (title: string) => (await request<{ id: string }>(`${base}/inbox`, { method: "POST", ...auth, body: { title } })).data.id;

    const off = await request(`${base}/modules/tasks`, { method: "PATCH", ...auth, body: { enabled: false, confirm: true } });
    expect(off.status).toBe(200);
    const refused = await request(`${base}/inbox/${await capture("Нельзя в задачу")}/process`, { method: "POST", ...auth, body: { kind: "task" } });
    expect(refused.status).toBe(409);

    const noteItem = await capture("В заметку");
    const asNote = await request<{ targetType: string; targetId: string; processedAt: string }>(`${base}/inbox/${noteItem}/process`, { method: "POST", ...auth, body: { kind: "note" } });
    expect([200, 201]).toContain(asNote.status);
    expect(asNote.data.targetType).toBe("note");
    expect(asNote.data.processedAt).toBeTruthy();
    const again = await request<{ targetId: string }>(`${base}/inbox/${noteItem}/process`, { method: "POST", ...auth, body: { kind: "note" } });
    expect(again.data.targetId).toBe(asNote.data.targetId);

    const on = await request(`${base}/modules/tasks`, { method: "PATCH", ...auth, body: { enabled: true } });
    expect(on.status).toBe(200);
    const asTask = await request<{ targetType: string }>(`${base}/inbox/${await capture("В задачу")}/process`, { method: "POST", ...auth, body: { kind: "task" } });
    expect([200, 201]).toContain(asTask.status);
    expect(asTask.data.targetType).toBe("task");
  });
});
