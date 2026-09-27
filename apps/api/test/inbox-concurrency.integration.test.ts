import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S21 «Idempotency inbox processing». `InboxService.process()` reads
 * `processedAt`, and if null, creates a target (task/note/event) and marks
 * the item processed. Two concurrent `process()` calls on the same item
 * (two tabs, a client retry racing its first request) must create exactly
 * ONE target — the barrier is a conditional `updateMany({ where:
 * { processedAt: null }, data: { processedAt } })` that atomically claims
 * the item BEFORE any target is created (see the file comment in
 * inbox.service.ts), not the earlier plain `findUnique` read, which by
 * itself cannot prevent the race (that is the bug this test would have
 * caught before the fix).
 */
describe("inbox — concurrent process() on one item creates exactly one target (S21)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `inbox-s21-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
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
      });
    }
    await app?.close();
  });

  it("two concurrent 'process as task' requests on the same item create exactly one Task", async () => {
    const owner = await register("race-task");
    const ws = owner.workspaceId;

    const captured = await request<{ id: string }>(`/workspaces/${ws}/inbox`, {
      method: "POST",
      token: owner.accessToken,
      body: { title: "Позвонить в банк", body: "", kind: "inbox" }
    });
    expect(captured.status).toBe(201);
    const itemId = captured.data.id;

    // Real concurrency: both requests fired together at the still-unprocessed item.
    const [a, b] = await Promise.all([
      request<{ processedAt: string | null; targetId: string | null }>(`/workspaces/${ws}/inbox/${itemId}/process`, {
        method: "POST",
        token: owner.accessToken,
        body: { kind: "task" }
      }),
      request<{ processedAt: string | null; targetId: string | null }>(`/workspaces/${ws}/inbox/${itemId}/process`, {
        method: "POST",
        token: owner.accessToken,
        body: { kind: "task" }
      })
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // Both requests succeed (idempotent response), but must report the SAME
    // target — the loser gets the winner's row back, not a fresh one.
    expect(a.data.targetId).not.toBeNull();
    expect(a.data.targetId).toBe(b.data.targetId);

    const tasks = await prisma.asSystem((tx) => tx.task.findMany({ where: { workspaceId: ws, title: "Позвонить в банк" } }));
    expect(tasks.length).toBe(1);

    const item = await prisma.asSystem((tx) => tx.inboxItem.findUniqueOrThrow({ where: { id: itemId } }));
    expect(item.targetId).toBe(tasks[0].id);
    expect(item.processedAt).not.toBeNull();
  });

  it("processing an already-processed item is a no-op that returns the existing target, not a new one", async () => {
    const owner = await register("already-done");
    const ws = owner.workspaceId;
    const captured = await request<{ id: string }>(`/workspaces/${ws}/inbox`, {
      method: "POST",
      token: owner.accessToken,
      body: { title: "Купить билеты", body: "", kind: "inbox" }
    });
    const itemId = captured.data.id;

    const first = await request<{ targetId: string }>(`/workspaces/${ws}/inbox/${itemId}/process`, {
      method: "POST",
      token: owner.accessToken,
      body: { kind: "note" }
    });
    expect(first.status).toBe(201);

    const second = await request<{ targetId: string }>(`/workspaces/${ws}/inbox/${itemId}/process`, {
      method: "POST",
      token: owner.accessToken,
      body: { kind: "note" }
    });
    expect(second.status).toBe(201);
    expect(second.data.targetId).toBe(first.data.targetId);

    const notes = await prisma.asSystem((tx) => tx.note.findMany({ where: { workspaceId: ws, title: "Купить билеты" } }));
    expect(notes.length).toBe(1);
  });

  async function register(name: string): Promise<{ accessToken: string; workspaceId: string }> {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const address = app.getHttpServer().address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});
