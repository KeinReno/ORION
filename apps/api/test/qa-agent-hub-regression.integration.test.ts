import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** QA-02 / QA-06: real HTTP + PostgreSQL/RLS, never a mocked "success". */
describe("GPT-QA Agent Hub ownership and lease regressions", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let origin: string;
  const prefix = "gptqa-hub-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  let seq = 0;
  const oldLimit = process.env.ORION_AI_RATE_LIMIT;

  beforeAll(async () => {
    process.env.ORION_AI_RATE_LIMIT = "1000";
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    origin = "http://127.0.0.1:" + (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (oldLimit === undefined) delete process.env.ORION_AI_RATE_LIMIT;
    else process.env.ORION_AI_RATE_LIMIT = oldLimit;
    try {
      if (prisma) await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const ids = users.map(u => u.id);
        if (!ids.length) return;
        const members = await tx.workspaceMember.findMany({
          where: { userId: { in: ids } }, select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(members.map(m => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        expect(await tx.agentHubExecution.count({ where: { workspaceId: { in: workspaceIds } } })).toBe(0);
      });
    } finally { await app?.close(); }
  });

  async function http<T = any>(method: string, path: string, bearer?: string, payload?: unknown) {
    const response = await fetch(origin + path, {
      method, headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {})
      },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const body = await response.text();
    return { status: response.status, data: (body ? JSON.parse(body) : null) as T };
  }

  async function setup() {
    const auth = await http<{ accessToken: string; user: { id: string } }>("POST", "/auth/register", undefined, {
      email: prefix + "-" + seq++ + "@example.test",
      name: "GPT-QA Owner", password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const id = auth.data.user.id;
    const ws = (await http<Array<{ id: string }>>("GET", "/workspaces/me", token)).data[0]!.id;
    const human = <T = any>(method: string, path: string, body?: unknown) =>
      http<T>(method, "/workspaces/" + ws + path, token, body);
    const issue = async () => {
      const created = await human<{ id: string; secret: string }>("POST", "/agent-tokens", {
        name: "GPT-QA worker",
        mode: "assistant", expiresInDays: 7, scopes: ["tasks:read"],
        modulePermissions: ["agent-hub.execution.read", "agent-hub.execution.create"]
      });
      expect(created.status).toBe(201);
      return {
        ...created.data,
        call: <T = any>(method: string, path: string, body?: unknown) =>
          http<T>(method, "/ai/v1/agent-hub" + path, created.data.secret, body)
      };
    };
    const task = await human<{ id: string }>("POST", "/tasks", { title: "GPT-QA task" });
    expect(task.status).toBe(201);
    const run = await human<{ id: string }>("POST", "/agent-hub/executions", { taskId: task.data.id });
    expect(run.status).toBe(201);
    return { human, issue, ws, ownerId: id, taskId: task.data.id, runId: run.data.id };
  }

  it("QA-06-01: simultaneous claims grant exactly one worker and write one claim event", async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.issue(), s.issue()]);
    const results = await Promise.all([
      a.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 0 }),
      b.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 0 })
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const current = await s.human<{ workerId: string; status: string; revision: number }>("GET", "/agent-hub/executions/" + s.runId);
    expect(current.data).toMatchObject({ status: "claimed", revision: 1 });
    expect([a.id, b.id]).toContain(current.data.workerId);
    const events = await s.human<Array<{ action: string; revision: number }>>("GET", "/agent-hub/executions/" + s.runId + "/events");
    expect(events.data.map(e => [e.action, e.revision])).toEqual([["create", 0], ["claim", 1]]);
  });

  it("QA-06-02: submission and cancellation cannot both win the same revision; no auto-close of the task", async () => {
    const s = await setup();
    const a = await s.issue();
    expect((await a.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 0 })).status).toBe(201);
    expect((await a.call("POST", "/executions/" + s.runId + "/report", {
      action: "start", expectedRevision: 1
    })).status).toBe(201);
    const responses = await Promise.all([
      a.call("POST", "/executions/" + s.runId + "/report", {
        action: "submit", expectedRevision: 2, evidenceRefs: ["git:qa-06-race"]
      }),
      s.human("POST", "/agent-hub/executions/" + s.runId + "/cancel", { expectedRevision: 2 })
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const current = await s.human<{ revision: number; status: string }>("GET", "/agent-hub/executions/" + s.runId);
    expect(current.data.revision).toBe(3);
    expect(["review", "canceled"]).toContain(current.data.status);
    const tasks = await s.human<Array<{ id: string; status: string }>>("GET", "/tasks");
    expect(tasks.data.find(t => t.id === s.taskId)?.status).toBe("todo");
    const events = await s.human<Array<{ revision: number }>>("GET", "/agent-hub/executions/" + s.runId + "/events");
    expect(events.data.map(e => e.revision)).toEqual([0, 1, 2, 3]);
  });

  it("QA-06-03: a worker cannot extend an already expired lease by heartbeat", async () => {
    const s = await setup();
    const a = await s.issue();
    expect((await a.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 0 })).status).toBe(201);
    // Start first so heartbeat would be a LEGAL transition before lease expiry.
    // Otherwise 409 could be caused by an unsupported action from "claimed",
    // producing a false positive for the lease-expiration test.
    expect((await a.call("POST", "/executions/" + s.runId + "/report", {
      action: "start", expectedRevision: 1
    })).status).toBe(201);
    await prisma.withUser(s.ownerId, tx => tx.agentHubExecution.update({
      where: { id: s.runId }, data: { leaseUntil: new Date(Date.now() - 1000) }
    }).then(() => undefined));
    const heartbeat = await a.call("POST", "/executions/" + s.runId + "/report", {
      action: "heartbeat", expectedRevision: 2
    });
    expect(heartbeat.status).toBe(409);
    const reconciliation = await s.human<{ recovered: number }>("POST", "/agent-hub/reconcile");
    expect(reconciliation.status).toBe(201);
    expect(reconciliation.data.recovered).toBe(1);
    const successor = await s.issue();
    expect((await successor.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 3 })).status).toBe(201);
    expect((await a.call("POST", "/executions/" + s.runId + "/report", {
      action: "submit", expectedRevision: 4, evidenceRefs: ["git:stale"]
    })).status).toBe(409);
  });

  it("QA-02-01: caller-supplied worker and workspace identities cannot override the bearer token", async () => {
    const s = await setup();
    const a = await s.issue();
    const b = await s.issue();
    const forged = await a.call<{ workerId: string; workspaceId: string }>("POST", "/executions/" + s.runId + "/claim", {
      expectedRevision: 0, workerId: b.id, workspaceId: "another-workspace", verifiedBy: a.id
    });
    // Rejecting an unknown field is also secure. If accepted, server must ignore it.
    expect([201, 400]).toContain(forged.status);
    if (forged.status === 201) {
      expect(forged.data.workerId).toBe(a.id);
      expect(forged.data.workspaceId).toBe(s.ws);
    }
  });

  it("QA-02-02: revoked agent credentials cannot heartbeat or submit an owned job", async () => {
    const s = await setup();
    const a = await s.issue();
    expect((await a.call("POST", "/executions/" + s.runId + "/claim", { expectedRevision: 0 })).status).toBe(201);
    const revoked = await s.human<{ revoked: number }>("POST", "/agent-tokens/revoke-all", {});
    expect(revoked.status).toBe(201);
    expect(revoked.data.revoked).toBeGreaterThan(0);
    expect((await a.call("GET", "/executions")).status).toBe(401);
    expect((await a.call("POST", "/executions/" + s.runId + "/report", {
      action: "start", expectedRevision: 1
    })).status).toBe(401);
    const current = await s.human<{ revision: number; status: string }>("GET", "/agent-hub/executions/" + s.runId);
    expect(current.data).toMatchObject({ revision: 1, status: "claimed" });
  });
});
