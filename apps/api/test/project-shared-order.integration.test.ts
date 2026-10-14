import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** «Порядок команды»: owner/lead write the shared project order, a plain member only reads it. */
describe("Project shared order", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `project-order-${runId}`;

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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { token: response.data.accessToken, userId: response.data.user.id, workspaceId: workspaces.data[0].id };
  }

  async function join(workspaceId: string, userId: string, role: "member" | "lead") {
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId, userId, role } }));
  }

  it("lets owner and lead reorder, forbids a member, persists and validates ids", async () => {
    const owner = await register("owner");
    const lead = await register("lead");
    const member = await register("member");
    const other = await register("other");
    await join(owner.workspaceId, lead.userId, "lead");
    await join(owner.workspaceId, member.userId, "member");
    const ws = owner.workspaceId;

    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const created = await request<{ id: string; sharedOrder: number | null }>(`/workspaces/${ws}/projects`, {
        method: "POST",
        token: owner.token,
        body: { name }
      });
      expect(created.status).toBe(201);
      expect(created.data.sharedOrder).toBeNull();
      ids.push(created.data.id);
    }
    const [a, b, c] = ids;
    const foreignProject = await request<{ id: string }>(`/workspaces/${other.workspaceId}/projects`, {
      method: "POST",
      token: other.token,
      body: { name: "Чужой" }
    });

    // member: 403, nothing written
    const denied = await request(`/workspaces/${ws}/projects/order`, { method: "PUT", token: member.token, body: { ids: [c, b, a] } });
    expect(denied.status).toBe(403);

    // lead: ok; stale id ignored
    const ok = await request<{ updated: number }>(`/workspaces/${ws}/projects/order`, {
      method: "PUT",
      token: lead.token,
      body: { ids: [c, "00000000-0000-0000-0000-000000000000", a, b] }
    });
    expect(ok.status).toBe(200);
    expect(ok.data.updated).toBe(3);

    // member reads the persisted order
    const list = await request<Array<{ id: string; sharedOrder: number | null }>>(`/workspaces/${ws}/projects`, { method: "GET", token: member.token });
    const orderOf = (id: string) => list.data.find((p) => p.id === id)?.sharedOrder;
    expect([orderOf(c), orderOf(a), orderOf(b)]).toEqual([0, 1, 2]);

    // a project of another workspace is invisible to the caller (RLS), so it is ignored like a stale id:
    // it is never written, and the rest of the request still applies atomically.
    const mixed = await request<{ updated: number }>(`/workspaces/${ws}/projects/order`, {
      method: "PUT",
      token: owner.token,
      body: { ids: [b, a, foreignProject.data.id] }
    });
    expect(mixed.status).toBe(200);
    expect(mixed.data.updated).toBe(2);
    const foreignRow = await prisma.asSystem((tx) => tx.project.findUnique({ where: { id: foreignProject.data.id } }));
    expect(foreignRow?.sharedOrder).toBeNull();
    const after = await request<Array<{ id: string; sharedOrder: number | null }>>(`/workspaces/${ws}/projects`, { method: "GET", token: owner.token });
    expect([after.data.find((p) => p.id === b)?.sharedOrder, after.data.find((p) => p.id === a)?.sharedOrder]).toEqual([0, 1]);

    // a user outside the workspace
    const outsider = await request(`/workspaces/${ws}/projects/order`, { method: "PUT", token: other.token, body: { ids: [a] } });
    expect(outsider.status).toBe(403);
  });
});
