import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MODULE_CATALOG, ORION_MODULE_IDS, type AgentHubExecution, type AgentHubEvent } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";
import { SNAPSHOT_MODEL_REGISTRY } from "../../../src/sync/snapshot-registry";

describe("Agent Hub: durable human queue v1", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  const prefix = `agenthub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let serial = 0;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
      const ids = users.map((u) => u.id);
      if (!ids.length) return;
      const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      expect(await tx.agentHubExecution.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
      expect(await tx.agentHubEvent.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
    });
    await app?.close();
  });

  async function request<T = any>(path: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function setup() {
    const auth = await request<{ accessToken: string }>("/auth/register", "POST", undefined, {
      email: `${prefix}-${serial++}@example.test`, password: "integration-password-123", name: "Владелец"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const ws = (await request<Array<{ id: string }>>("/workspaces/me", "GET", token)).data[0]!.id;
    const call = <T = any>(method: string, path: string, body?: unknown) =>
      request<T>(`/workspaces/${ws}/agent-hub${path}`, method, token, body);
    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, "POST", token, { title: "Проверить выполнение" });
    expect(task.status).toBe(201);
    return {
      ws, token, taskId: task.data.id, call,
      setModule: (enabled: boolean) => request(`/workspaces/${ws}/modules/agent-hub`, "PATCH", token, { enabled })
    };
  }

  it("is a registered optional module with persistent snapshot models", () => {
    expect(ORION_MODULE_IDS).toContain("agent-hub");
    expect(MODULE_CATALOG.find((m) => m.id === "agent-hub")?.defaultEnabled).toBe(false);
    for (const model of ["AgentHubExecution", "AgentHubEvent"]) {
      expect(SNAPSHOT_MODEL_REGISTRY.find((m) => m.model === model)?.policy).toBe("included");
    }
  });

  it("creates one execution with atomic journal; repeats idempotently by requestId", async () => {
    const s = await setup();
    await s.setModule(true);
    const requestId = crypto.randomUUID();
    const first = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId, requestId });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data).toMatchObject({ id: requestId, workspaceId: s.ws, target: { kind: "task", id: s.taskId }, status: "queued", revision: 0 });
    const repeat = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId, requestId });
    expect(repeat.status).toBe(201);
    expect(repeat.data.id).toBe(requestId);
    const events = await s.call<AgentHubEvent[]>("GET", `/executions/${requestId}/events`);
    expect(events.data).toHaveLength(1);
    expect(events.data[0]).toMatchObject({ action: "create", revision: 0 });
    const duplicate = await s.call("POST", "/executions", { taskId: s.taskId });
    expect(duplicate.status).toBe(409);
  });

  it("only one competing create can succeed for the same task", async () => {
    const s = await setup();
    await s.setModule(true);
    const [first, second] = await Promise.all([
      s.call("POST", "/executions", { taskId: s.taskId }),
      s.call("POST", "/executions", { taskId: s.taskId })
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const runs = await s.call<AgentHubExecution[]>("GET", "/executions");
    expect(runs.data).toHaveLength(1);
  });

  it("cancels with expected revision and appends one event; terminal immutable", async () => {
    const s = await setup();
    await s.setModule(true);
    const created = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId });
    const id = created.data.id;
    const canceled = await s.call<AgentHubExecution>("POST", `/executions/${id}/cancel`, { expectedRevision: 0 });
    expect(canceled.status).toBe(201);
    expect(canceled.data).toMatchObject({ status: "canceled", revision: 1 });
    expect((await s.call("POST", `/executions/${id}/cancel`, { expectedRevision: 0 })).status).toBe(409);
    const events = await s.call<AgentHubEvent[]>("GET", `/executions/${id}/events`);
    expect(events.data.map((e) => [e.revision, e.action])).toEqual([[0, "create"], [1, "cancel"]]);
    // Terminal execution frees the unique partial index for an independent retry.
    expect((await s.call("POST", "/executions", { taskId: s.taskId })).status).toBe(201);
  });

  it("isolates different workspaces and refuses non-existent task ids", async () => {
    const a = await setup(), b = await setup();
    await a.setModule(true);
    await b.setModule(true);
    expect((await a.call("POST", "/executions", { taskId: b.taskId })).status).toBe(404);
    const created = await a.call<AgentHubExecution>("POST", "/executions", { taskId: a.taskId });
    expect((await b.call("GET", `/executions/${created.data.id}`)).status).toBe(404);
    expect((await b.call("GET", `/executions/${created.data.id}/events`)).status).toBe(404);
  });

  it("disabling the module denies API but preserves the queue and history", async () => {
    const s = await setup();
    await s.setModule(true);
    const first = await s.call<AgentHubExecution>("POST", "/executions", { taskId: s.taskId });
    await s.setModule(false);
    expect((await s.call("GET", "/executions")).status).toBe(409);
    await s.setModule(true);
    const runs = await s.call<AgentHubExecution[]>("GET", "/executions");
    expect(runs.data.map((r) => r.id)).toEqual([first.data.id]);
    expect((await s.call<AgentHubEvent[]>("GET", `/executions/${first.data.id}/events`)).data).toHaveLength(1);
  });
});
