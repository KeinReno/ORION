import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";

/**
 * Manual MCP is a caller-driven session: no server-side IDE launch.
 * Covers project fences, token-bound workers, CAS and failed lease recovery.
 */
describe("Agent Hub manual MCP adapter", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let root: string;
  const prefix = `agent-hub-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let seq = 0;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    root = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async tx => {
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const userIds = users.map(u => u.id);
        if (userIds.length === 0) return;
        const members = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(members.map(m => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(method: string, path: string, token?: string, body?: unknown) {
    const res = await fetch(root + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup() {
    const auth = await request<{ accessToken: string; user: { id: string } }>("POST", "/auth/register", undefined, {
      email: `${prefix}-${seq++}@example.test`, name: "Владелец", password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const userId = auth.data.user.id;
    const ws = (await request<Array<{ id: string }>>("GET", "/workspaces/me", token)).data[0]!.id;
    const human = <T = unknown>(method: string, path: string, body?: unknown) =>
      request<T>(method, `/workspaces/${ws}${path}`, token, body);
    const issue = async (config: Record<string, unknown> = {}) => {
      const result = await human<{ id: string; secret: string }>("POST", "/agent-tokens", {
        name: "Manual MCP Worker", mode: "assistant", expiresInDays: 7,
        scopes: ["tasks:read"], modulePermissions: ["agent-hub.execution.read", "agent-hub.execution.create"],
        ...config
      });
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      return { ...result.data, call: <T = unknown>(method: string, path: string, body?: unknown) =>
        request<T>(method, `/ai/v1/agent-hub${path}`, result.data.secret, body) };
    };
    const task = await human<{ id: string }>("POST", "/tasks", { title: "Попытка выполнения в IDE" });
    expect(task.status).toBe(201);
    const run = await human<{ id: string; revision: number }>("POST", "/agent-hub/executions", { taskId: task.data.id });
    expect(run.status, JSON.stringify(run.data)).toBe(201);
    return { human, token, userId, ws, issue, taskId: task.data.id, runId: run.data.id };
  }

  it("claims and reports a real manual execution without self-verifying completion", async () => {
    const s = await setup();
    const worker = await s.issue();
    const other = await s.issue({ name: "Other worker" });
    const queue = await worker.call<Array<{ id: string; revision: number }>>("GET", "/executions");
    expect(queue.status).toBe(200);
    expect(queue.data.map(r => r.id)).toContain(s.runId);

    const claim = await worker.call<{ revision: number; status: string; workerId: string }>("POST", `/executions/${s.runId}/claim`, { expectedRevision: 0 });
    expect(claim.status).toBe(201);
    expect(claim.data).toMatchObject({ status: "claimed", revision: 1, workerId: worker.id });
    expect((await other.call("POST", `/executions/${s.runId}/claim`, { expectedRevision: 1 })).status).toBe(409);
    expect((await other.call("POST", `/executions/${s.runId}/report`, { action: "start", expectedRevision: 1 })).status).toBe(409);
    expect((await worker.call("POST", `/executions/${s.runId}/report`, { action: "start", expectedRevision: 0 })).status).toBe(409);

    const working = await worker.call<{ revision: number; status: string }>("POST", `/executions/${s.runId}/report`, { action: "start", expectedRevision: 1 });
    expect(working.data).toMatchObject({ revision: 2, status: "working" });
    const checkpoint = await worker.call<{ revision: number; checkpointRef: string }>("POST", `/executions/${s.runId}/report`, {
      action: "checkpoint", expectedRevision: 2, checkpointRef: "git:abc123"
    });
    expect(checkpoint.data.checkpointRef).toBe("git:abc123");
    const heartbeat = await worker.call<{ revision: number; status: string }>("POST", `/executions/${s.runId}/report`, {
      action: "heartbeat", expectedRevision: 3
    });
    expect(heartbeat.data.revision).toBe(4);
    const submitted = await worker.call<{ revision: number; status: string; evidenceRefs: string[] }>("POST", `/executions/${s.runId}/report`, {
      action: "submit", expectedRevision: 4, evidenceRefs: ["git:def456", "test:passed"]
    });
    expect(submitted.data).toMatchObject({ status: "review", revision: 5, evidenceRefs: ["git:def456", "test:passed"] });
    const events = await s.human<Array<{ action: string; revision: number; data: Record<string, unknown> }>>("GET", `/agent-hub/executions/${s.runId}/events`);
    expect(events.data.map(e => e.action)).toEqual(["create", "claim", "start", "checkpoint", "heartbeat", "submit"]);
    expect(events.data.map(e => e.revision)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.data[5]!.data.evidenceRefs).toEqual(["git:def456", "test:passed"]);
    expect((await worker.call("POST", `/executions/${s.runId}/report`, { action: "start", expectedRevision: 5 })).status).toBe(409);
  });

  it("does not bypass task read scope or project fences", async () => {
    const s = await setup();
    const noTasks = await s.issue({ name: "No task scope", scopes: [] });
    expect((await noTasks.call("GET", "/executions")).status).toBe(403);
    expect((await noTasks.call("POST", `/executions/${s.runId}/claim`, { expectedRevision: 0 })).status).toBe(403);

    const project = await s.human<{ id: string }>("POST", "/projects", { name: "Only allowed project" });
    expect(project.status).toBe(201);
    const fenced = await s.issue({ name: "Project-fenced", allowedProjectIds: [project.data.id] });
    expect((await fenced.call<Array<{ id: string }>>("GET", "/executions")).data).toEqual([]);
    expect((await fenced.call("POST", `/executions/${s.runId}/claim`, { expectedRevision: 0 })).status).toBe(403);

    const observer = await s.issue({ name: "Read only", modulePermissions: ["agent-hub.execution.read"] });
    expect((await observer.call("GET", "/executions")).status).toBe(200);
    expect((await observer.call("POST", `/executions/${s.runId}/claim`, { expectedRevision: 0 })).status).toBe(403);
  });

  it("requires explicit owner reconciliation of an expired lease; preserves checkpoint for successor", async () => {
    const s = await setup();
    const worker = await s.issue();
    const successor = await s.issue({ name: "Successor" });
    const claim = await worker.call("POST", `/executions/${s.runId}/claim`, { expectedRevision: 0 });
    expect(claim.status).toBe(201);
    expect((await worker.call("POST", `/executions/${s.runId}/report`, { action: "start", expectedRevision: 1 })).status).toBe(201);
    expect((await worker.call("POST", `/executions/${s.runId}/report`, {
      action: "checkpoint", expectedRevision: 2, checkpointRef: "git:last-safe-commit"
    })).status).toBe(201);

    await prisma.withUser(s.userId, tx => tx.agentHubExecution.update({
      where: { id: s.runId }, data: { leaseUntil: new Date(Date.now() - 1000) }
    }).then(() => undefined));
    const rec = await s.human<{ recovered: number }>("POST", "/agent-hub/reconcile");
    expect(rec.status).toBe(201);
    expect(rec.data.recovered).toBe(1);
    expect((await s.human<{ recovered: number }>("POST", "/agent-hub/reconcile")).data.recovered).toBe(0);
    const claim2 = await successor.call<{ revision: number; status: string; checkpointRef: string; workerId: string; attempt: number }>(
      "POST", `/executions/${s.runId}/claim`, { expectedRevision: 4 }
    );
    expect(claim2.status, JSON.stringify(claim2.data)).toBe(201);
    expect(claim2.data).toMatchObject({ status: "claimed", revision: 5, attempt: 2, checkpointRef: "git:last-safe-commit", workerId: successor.id });
    expect((await worker.call("POST", `/executions/${s.runId}/report`, { action: "heartbeat", expectedRevision: 5 })).status).toBe(409);
  });
});
