import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** QA-02 / QA-06: real HTTP + PostgreSQL/RLS, never a mocked "success". */
describe("GPT-QA agent token policy regressions", () => {
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

  async function http<T = unknown>(method: string, path: string, bearer?: string, payload?: unknown) {
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
    const human = <T = unknown>(method: string, path: string, body?: unknown) =>
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
        call: <T = unknown>(method: string, path: string, body?: unknown) =>
          http<T>(method, "/ai/v1/agent-hub" + path, created.data.secret, body)
      };
    };
    const task = await human<{ id: string }>("POST", "/tasks", { title: "GPT-QA task" });
    expect(task.status).toBe(201);
    const run = await human<{ id: string }>("POST", "/agent-hub/executions", { taskId: task.data.id });
    expect(run.status).toBe(201);
    return { human, issue, ws, ownerId: id, taskId: task.data.id, runId: run.data.id };
  }

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
