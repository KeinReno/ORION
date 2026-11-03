import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Серверный режим больше не навязывает свои сроки и роли; ими управляет владелец.
 * Проверяется при переключении env на одном приложении.
 */
describe("Agent tokens in server mode (ADR-0017)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const emailPrefix = `agent-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    delete process.env.ORION_MODE;
    delete process.env.ORION_AI_BRIDGE;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        const ids = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      });
    }
    await app?.close();
  });

  async function request<T = any>(path: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function owner() {
    const registered = await request<{ accessToken: string }>("/auth/register", "POST", undefined, {
      email: `${emailPrefix}-${counter++}@example.test`,
      password: "integration-password-123",
      name: "Владелец"
    });
    const token = registered.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", "GET", token);
    return { token, ws: workspaces.data[0]!.id };
  }

  it("локально ничего не меняется: менеджер, бессрочный токен и без запрета удаления допустимы", async () => {
    const { token, ws } = await owner();
    const created = await request(`/workspaces/${ws}/agent-tokens`, "POST", token, { name: "Локальный", scopes: ["notes:read"], mode: "manager", expiresInDays: null, forbidden: [] });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ mode: "manager", expiresAt: null, forbidden: [] });
  });

  it("на сервере сохраняет явно выбранные срок, роль и запреты", async () => {
    const { token, ws } = await owner();
    process.env.ORION_MODE = "server";
    process.env.ORION_AI_BRIDGE = "1";
    const issue = (body: Record<string, unknown>) => request(`/workspaces/${ws}/agent-tokens`, "POST", token, { name: "Удалённый", scopes: ["notes:read"], ...body });

    expect((await issue({ mode: "manager", expiresInDays: 7 })).status).toBe(201);
    expect((await issue({ mode: "assistant", expiresInDays: null })).status).toBe(201);
    expect((await issue({ mode: "assistant", expiresInDays: 31 })).status).toBe(201);

    const ok = await issue({ mode: "assistant", expiresInDays: 30, forbidden: [] });
    expect(ok.status).toBe(201);
    expect(ok.data.forbidden).toEqual([]);
    expect(ok.data.expiresAt).not.toBeNull();

    // Выпущенный токен нельзя «повысить» до менеджера или лишить запрета удаления.
    const patch = (body: Record<string, unknown>) => request(`/workspaces/${ws}/agent-tokens/${ok.data.id}`, "PATCH", token, body);
    expect((await patch({ mode: "manager" })).status).toBe(200);
    expect((await patch({ forbidden: [] })).status).toBe(200);
    expect((await patch({ mode: "observer", forbidden: ["delete", "finance"] })).status).toBe(200);
  });

  it("owner decision (2026-10-29): admin IS allowed on the server, without a forced delete-forbid, unlike every other mode", async () => {
    const { token, ws } = await owner();
    process.env.ORION_MODE = "server";
    process.env.ORION_AI_BRIDGE = "1";
    const issue = (body: Record<string, unknown>) => request(`/workspaces/${ws}/agent-tokens`, "POST", token, { name: "Админ на сервере", mode: "admin", expiresInDays: 30, forbidden: [], ...body });

    const ok = await issue({});
    expect(ok.status, JSON.stringify(ok.data)).toBe(201);
    expect(ok.data).toMatchObject({ mode: "admin", forbidden: [] });

    // The owner may deliberately issue indefinite or long-lived administrator credentials.
    expect((await issue({ expiresInDays: null })).status).toBe(201);
    expect((await issue({ expiresInDays: 365 })).status).toBe(201);

    // Updating a live token to admin on the server also isn't forced into a delete-forbid.
    const patch = (body: Record<string, unknown>) => request(`/workspaces/${ws}/agent-tokens/${ok.data.id}`, "PATCH", token, body);
    expect((await patch({ forbidden: [] })).status).toBe(200);
  });
});
