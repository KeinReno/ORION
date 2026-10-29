import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";

const capabilities = { canStart: false, canCancel: false, canObserve: true, canResume: false };

describe("Agent Hub runtime session registry (reported presence, not attestation)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let root: string;
  let serial = 0;
  const prefix = `runtime-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    root = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async tx => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map(u => u.id);
      if (!ids.length) return;
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      const workspaceIds = [...new Set(memberships.map(m => m.workspaceId))];
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    });
    await app?.close();
  });

  async function request<T = any>(method: string, path: string, bearer?: string, body?: unknown) {
    const response = await fetch(root + path, {
      method,
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup() {
    const auth = await request<{ accessToken: string; user: { id: string } }>("POST", "/auth/register", undefined, {
      email: `${prefix}-${serial++}@example.test`, name: "Registry test", password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const ws = (await request<Array<{ id: string }>>("GET", "/workspaces/me", auth.data.accessToken)).data[0]!.id;
    const human = <T = any>(method: string, path: string, body?: unknown) =>
      request<T>(method, `/workspaces/${ws}/agent-hub${path}`, auth.data.accessToken, body);
    const issue = async (overrides: Record<string, unknown> = {}) => {
      const response = await request<{ id: string; secret: string }>("POST", `/workspaces/${ws}/agent-tokens`, auth.data.accessToken, {
        name: "Runtime observer", mode: "assistant", expiresInDays: 7,
        scopes: ["tasks:read"], modulePermissions: ["agent-hub.execution.create"], ...overrides
      });
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      return { ...response.data, call: <T = any>(method: string, path: string, body?: unknown) =>
        request<T>(method, `/ai/v1/agent-hub${path}`, response.data.secret, body) };
    };
    return { human, issue, ws, userId: auth.data.user.id };
  }

  it("registers, pulses, closes and preserves only a reported status", async () => {
    const s = await setup(), agent = await s.issue();
    const sessionId = crypto.randomUUID();
    const input = { sessionId, kind: "habitat_observer", capabilities };
    const registered = await agent.call<{ revision: number; presence: string }>("POST", "/runtime-sessions", input);
    expect(registered.status).toBe(201);
    expect(registered.data).toMatchObject({ revision: 0, presence: "recent" });
    expect((await agent.call("POST", "/runtime-sessions", input)).status).toBe(201);
    expect((await agent.call("POST", `/runtime-sessions/${sessionId}/pulse`, { expectedRevision: 9 })).status).toBe(409);
    const pulsed = await agent.call<{ revision: number }>("POST", `/runtime-sessions/${sessionId}/pulse`, { expectedRevision: 0 });
    expect(pulsed.data.revision).toBe(1);
    const closed = await agent.call<{ presence: string }>("POST", `/runtime-sessions/${sessionId}/close`, { expectedRevision: 1 });
    expect(closed.data.presence).toBe("closed");
    expect((await agent.call("POST", `/runtime-sessions/${sessionId}/pulse`, { expectedRevision: 2 })).status).toBe(409);
    const list = await s.human<Array<{ id: string; presence: string }>>("GET", "/runtime-sessions");
    expect(list.data.find(r => r.id === sessionId)?.presence).toBe("closed");
  });

  it("rejects claimed execution capabilities and foreign token sessions", async () => {
    const s = await setup(), a = await s.issue(), b = await s.issue({ name: "Second observer" });
    const sessionId = crypto.randomUUID();
    expect((await a.call("POST", "/runtime-sessions", {
      sessionId, kind: "habitat_observer", capabilities: { ...capabilities, canStart: true }
    })).status).toBe(400);
    expect((await a.call("POST", "/runtime-sessions", { sessionId, kind: "habitat_observer", capabilities })).status).toBe(201);
    expect((await b.call("POST", `/runtime-sessions/${sessionId}/pulse`, { expectedRevision: 0 })).status).toBe(404);
    expect((await b.call("POST", "/runtime-sessions", { sessionId, kind: "habitat_observer", capabilities })).status).toBe(403);
    const noTaskScope = await s.issue({ name: "No tasks", scopes: [] });
    expect((await noTaskScope.call("POST", "/runtime-sessions", {
      sessionId: crypto.randomUUID(), kind: "habitat_observer", capabilities
    })).status).toBe(403);
  });

  it("expiry becomes stale and refuses resurrection of an expired session", async () => {
    const s = await setup(), agent = await s.issue();
    const sessionId = crypto.randomUUID();
    expect((await agent.call("POST", "/runtime-sessions", { sessionId, kind: "habitat_observer", capabilities })).status).toBe(201);
    await prisma.withUser(s.userId, async tx => {
      await tx.agentHubRuntimeSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    });
    const list = await s.human<Array<{ id: string; presence: string }>>("GET", "/runtime-sessions");
    expect(list.data.find(v => v.id === sessionId)?.presence).toBe("stale");
    expect((await agent.call("POST", `/runtime-sessions/${sessionId}/pulse`, { expectedRevision: 0 })).status).toBe(409);
    expect((await agent.call("POST", "/runtime-sessions", { sessionId, kind: "habitat_observer", capabilities })).status).toBe(409);
  });
});
