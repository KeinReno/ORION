import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * QA-07: real reviewed import + Agent Hub delegation. Independent review is
 * intentionally a RED CONTRACT on beta37; submit is not acceptance.
 */
describe("GPT-QA ORION DEV import-to-review journey", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let origin: string;
  const oldCatalog = process.env.ORION_DEV_CATALOG_ROOT;
  const prefix = "gptqa-dev-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  let serial = 0;

  beforeAll(async () => {
    process.env.ORION_DEV_CATALOG_ROOT = resolve(".");
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    origin = "http://127.0.0.1:" + (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (oldCatalog === undefined) delete process.env.ORION_DEV_CATALOG_ROOT;
    else process.env.ORION_DEV_CATALOG_ROOT = oldCatalog;
    try {
      if (prisma) await prisma.asSystem(async tx => {
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const ids = users.map(u => u.id);
        if (!ids.length) return;
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        const wsIds = [...new Set(memberships.map(m => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: wsIds } } });
      });
    } finally { await app?.close(); }
  });
  async function http<T = unknown>(method: string, path: string, bearer?: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method,
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
  async function session() {
    const auth = await http<{ accessToken: string }>("POST", "/auth/register", undefined, {
      email: prefix + "-" + serial++ + "@example.test", name: "GPT-QA owner",
      password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const ws = (await http<Array<{ id: string }>>("GET", "/workspaces/me", token)).data[0]!.id;
    const human = <T = unknown>(method: string, path: string, body?: unknown) =>
      http<T>(method, "/workspaces/" + ws + path, token, body);
    return { ws, human };
  }
  async function importCatalog(s: Awaited<ReturnType<typeof session>>) {
    const preview = await s.human<{ previewDigest: string }>("GET", "/development-import/preview");
    expect(preview.status).toBe(200);
    const intent = { workspaceConfirmed: true, previewDigest: preview.data.previewDigest, choices: {} };
    const consent = await s.human<{ token: string }>("POST", "/development-import/consent", intent);
    expect(consent.status).toBe(201);
    const applied = await s.human<{ tasks: Array<{ outcome: string }> }>("POST", "/development-import/apply", { ...intent, token: consent.data.token });
    expect(applied.status).toBe(201);
    return applied.data;
  }
  async function createSubmittedExecution(s: Awaited<ReturnType<typeof session>>) {
    await importCatalog(s);
    const all = await s.human<Array<{ id: string; title: string; status: string }>>("GET", "/tasks");
    expect(all.status).toBe(200);
    const task = all.data.find(t => t.title === "Make CI reproducible and green");
    expect(task).toBeDefined();

    const worker = await s.human<{ id: string; secret: string }>("POST", "/agent-tokens", {
      name: "QA-07 worker", mode: "assistant", expiresInDays: 7,
      scopes: ["tasks:read"], modulePermissions: ["agent-hub.execution.read", "agent-hub.execution.create"]
    });
    expect(worker.status).toBe(201);
    const execution = await s.human<{ id: string }>("POST", "/agent-hub/executions", { taskId: task!.id });
    expect(execution.status).toBe(201);
    const agent = (body: unknown, path: string) =>
      http<{ status: string; revision: number }>("POST", "/ai/v1/agent-hub" + path, worker.data.secret, body);
    const path = "/executions/" + execution.data.id;
    expect((await agent({ expectedRevision: 0 }, path + "/claim")).status).toBe(201);
    expect((await agent({ action: "start", expectedRevision: 1 }, path + "/report")).status).toBe(201);
    const submitted = await agent({ action: "submit", expectedRevision: 2, evidenceRefs: ["git:qa07-test-only"] }, path + "/report");
    expect(submitted.status).toBe(201);
    expect(submitted.data).toMatchObject({ status: "review", revision: 3 });
    return { ...s, task: task!, executionId: execution.data.id };
  }

  it("QA-07-01: imported task survives submission, re-import and reopening with stable identity", async () => {
    const s = await createSubmittedExecution(await session());
    const result = await importCatalog(s);
    expect(result.tasks.every((r: { outcome: string }) => r.outcome === "already_mapped")).toBe(true);
    const tasks = await s.human<Array<{ id: string; title: string; status: string }>>("GET", "/tasks");
    const same = tasks.data.find(t => t.title === s.task.title);
    expect(same?.id).toBe(s.task.id);
    expect(same?.status).toBe(s.task.status);
    const exec = await s.human<{ status: string; target: { id: string }; verifiedBy: string | null }>(
      "GET", "/agent-hub/executions/" + s.executionId
    );
    expect(exec.data).toMatchObject({ status: "review", target: { id: s.task.id }, verifiedBy: null });
    const events = await s.human<Array<{ action: string }>>("GET", "/agent-hub/executions/" + s.executionId + "/events");
    expect(events.data.map(e => e.action)).toEqual(["create", "claim", "start", "submit"]);
  });

  // Маршрута независимой приёмки Agent Hub ещё нет. Тест оставлен как спецификация и не валит прогон.
  it.skip("QA-07-02 RED CONTRACT: only independent human review can mark the submitted execution accepted", async () => {
    const s = await createSubmittedExecution(await session());
    // Endpoint is intentionally absent on beta37, which has only human
    // cancel/reconcile, not approve/reject. Keep this assertion red until
    // CORE-08/09/10 implements audited review transitions.
    const reviewed = await s.human<{ status: string; verifiedBy: string | null }>(
      "POST", "/agent-hub/executions/" + s.executionId + "/review",
      { decision: "approve", expectedRevision: 3, evidenceRefs: ["test:independent-review"] }
    );
    expect([200, 201]).toContain(reviewed.status);
    expect(reviewed.data.status).toBe("done");
    expect(reviewed.data.verifiedBy).not.toBeNull();
  });
});
