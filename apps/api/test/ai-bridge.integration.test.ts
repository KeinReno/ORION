import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
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

describe("AI Bridge (agent tokens)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `aibridge-${runId}`;

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

  async function issue(owner: RegisteredSession, scopes: string[], expiresInDays = 30) {
    const created = await request<{ id: string; secret: string; prefix: string }>(`/workspaces/${owner.workspaceId}/agent-tokens`, {
      method: "POST", token: owner.accessToken, body: { name: "Claude", scopes, expiresInDays }
    });
    expect(created.status).toBe(201);
    return created.data;
  }

  it("токен работает в рамках своих разрешений, секрет виден один раз, действия в журнале", async () => {
    const alice = await register("alice");
    const token = await issue(alice, ["tasks:read", "tasks:write"]);
    expect(token.secret.startsWith("orion_agt_")).toBe(true);

    const listed = await request<Array<{ id: string; secret?: string }>>(`/workspaces/${alice.workspaceId}/agent-tokens`, {
      method: "GET", token: alice.accessToken
    });
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed.data)).not.toContain(token.secret);

    const me = await request<{ workspaceId: string; scopes: string[] }>("/ai/v1/me", { method: "GET", token: token.secret });
    expect(me.status).toBe(200);
    expect(me.data.workspaceId).toBe(alice.workspaceId);

    const task = await request<{ id: string; title: string }>("/ai/v1/tasks", {
      method: "POST", token: token.secret, body: { title: "Создано агентом" }
    });
    expect(task.status).toBe(201);
    const patched = await request<{ status: string }>(`/ai/v1/tasks/${task.data.id}`, {
      method: "PATCH", token: token.secret, body: { status: "in_progress" }
    });
    expect(patched.status).toBe(200);
    // Fields outside the agent's patch (e.g. assignee) are rejected, not silently applied.
    const sneaky = await request(`/ai/v1/tasks/${task.data.id}`, {
      method: "PATCH", token: token.secret, body: { assigneeId: alice.user.id }
    });
    expect(sneaky.status).toBeLessThan(500);

    // The human sees the same task in the ordinary API.
    const humanView = await request<Array<{ id: string }>>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "GET", token: alice.accessToken
    });
    expect(humanView.data.map((t) => t.id)).toContain(task.data.id);

    // No notes scope → 403, and it is audited.
    const denied = await request("/ai/v1/notes", { method: "GET", token: token.secret });
    expect(denied.status).toBe(403);

    const audit = await request<Array<{ action: string; status: number }>>(`/workspaces/${alice.workspaceId}/agent-tokens/audit`, {
      method: "GET", token: alice.accessToken
    });
    const actions = audit.data.map((e) => `${e.action}:${e.status}`);
    expect(actions).toContain("tasks.create:200");
    expect(actions).toContain("notes.list:403");
  });

  it("отозванный, истёкший, чужой и обычный JWT-токен не проходят", async () => {
    const alice = await register("alice2");
    const bob = await register("bob2");
    const token = await issue(alice, ["tasks:read"]);

    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);
    // A user session JWT is not an agent credential.
    expect((await request("/ai/v1/tasks", { method: "GET", token: alice.accessToken })).status).toBe(401);
    expect((await request("/ai/v1/tasks", { method: "GET", token: "orion_agt_nonsense" })).status).toBe(401);

    // Another member cannot revoke (or even see) Alice's token.
    const foreignRevoke = await request(`/workspaces/${alice.workspaceId}/agent-tokens/${token.id}`, {
      method: "DELETE", token: bob.accessToken
    });
    expect([403, 404]).toContain(foreignRevoke.status);
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);

    // Expiry.
    await prisma.asSystem((tx) => tx.agentToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(401);
    await prisma.asSystem((tx) => tx.agentToken.update({ where: { id: token.id }, data: { expiresAt: null } }));
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);

    const revoked = await request(`/workspaces/${alice.workspaceId}/agent-tokens/${token.id}`, {
      method: "DELETE", token: alice.accessToken
    });
    expect(revoked.status).toBe(204);
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(401);
  });

  it("токен не видит чужое пространство и теряет доступ, когда владелец вышел из пространства", async () => {
    const alice = await register("alice3");
    const bob = await register("bob3");
    await request(`/workspaces/${bob.workspaceId}/tasks`, { method: "POST", token: bob.accessToken, body: { title: "Секрет Боба" } });
    const token = await issue(alice, ["tasks:read"]);
    const tasks = await request<Array<{ title: string }>>("/ai/v1/tasks", { method: "GET", token: token.secret });
    expect(tasks.data.map((t) => t.title)).not.toContain("Секрет Боба");

    await prisma.asSystem((tx) => tx.workspaceMember.deleteMany({ where: { userId: alice.user.id, workspaceId: alice.workspaceId } }));
    const after = await request("/ai/v1/tasks", { method: "GET", token: token.secret });
    expect([403, 404]).toContain(after.status);
  });

  it("MCP-сервер (stdio) проходит рукопожатие, показывает инструменты и работает через токен", async () => {
    const alice = await register("alice-mcp");
    const token = await issue(alice, ["tasks:read", "tasks:write"]);
    const script = resolve(__dirname, "../../../scripts/orion-mcp.mjs");
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ORION_API_URL: baseUrl, ORION_AGENT_TOKEN: token.secret },
      stdio: ["pipe", "pipe", "pipe"]
    });
    interface Rpc {
      id: number;
      result: { serverInfo: { name: string }; tools: Array<{ name: string }>; isError?: boolean; content: Array<{ text: string }> };
    }
    const pending = new Map<number, (value: Rpc) => void>();
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      }
    });
    let nextId = 1;
    const rpc = (method: string, params?: unknown) =>
      new Promise<Rpc>((done) => {
        const id = nextId++;
        pending.set(id, done);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    try {
      const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(init.result.serverInfo.name).toBe("orion");
      const list = await rpc("tools/list");
      expect(list.result.tools.map((t) => t.name)).toContain("orion_create_task");

      const created = await rpc("tools/call", { name: "orion_create_task", arguments: { title: "Через MCP" } });
      expect(created.result.isError).toBeUndefined();
      expect(JSON.parse(created.result.content[0].text).title).toBe("Через MCP");

      // A scope the token lacks comes back as a tool error the model can read, not a crash.
      const denied = await rpc("tools/call", { name: "orion_list_notes", arguments: {} });
      expect(denied.result.isError).toBe(true);
      expect(denied.result.content[0].text).toContain("403");
    } finally {
      child.kill();
    }
  });

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
