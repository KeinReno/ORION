import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

describe("opening search results outside loaded lists", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const prefix = `focus-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((member) => member.workspaceId) } } });
      });
    }
    await app?.close();
  });

  async function request(path: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  }

  async function register(name: string) {
    const session = await request("/auth/register", undefined, { email: `${prefix}-${name}@example.test`, password: "integration-password-123", name });
    expect(session.status).toBe(201);
    const token = session.data.accessToken as string;
    const spaces = await request("/workspaces/me", token);
    return { token, workspaceId: (spaces.data as unknown as Array<{ id: string }>)[0].id };
  }

  it("loads an old event and transaction by ID, but never from another workspace", async () => {
    const first = await register("first");
    const second = await register("second");
    const rows = await prisma.asSystem(async (tx) => {
      const event = await tx.event.create({ data: {
        workspaceId: first.workspaceId, title: "Old event", description: "", startAt: new Date("2020-01-01T10:00:00Z"),
        endAt: new Date("2020-01-01T11:00:00Z"), allDay: false, reminders: []
      } });
      const account = await tx.account.create({ data: { workspaceId: first.workspaceId, name: "Cash" } });
      const transaction = await tx.transaction.create({ data: {
        workspaceId: first.workspaceId, accountId: account.id, type: "expense", note: "Old receipt", tags: [],
        occurredAt: new Date("2020-01-01T12:00:00Z"), lines: { create: [{ workspaceId: first.workspaceId, amount: 100 }] }
      } });
      return { event, transaction };
    });

    const eventPath = `/workspaces/${first.workspaceId}/events/${rows.event.id}`;
    const transactionPath = `/workspaces/${first.workspaceId}/finance/transactions/${rows.transaction.id}`;
    expect((await request(eventPath, first.token)).data.id).toBe(rows.event.id);
    expect((await request(transactionPath, first.token)).data.id).toBe(rows.transaction.id);
    expect((await request(`/workspaces/${second.workspaceId}/events/${rows.event.id}`, second.token)).status).toBe(404);
    expect((await request(`/workspaces/${second.workspaceId}/finance/transactions/${rows.transaction.id}`, second.token)).status).toBe(404);
  });
});
