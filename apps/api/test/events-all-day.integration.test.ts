import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Contract (packages/shared-types/src/event.ts): an all-day event's startAt
 * is UTC midnight of its first day and endAt is UTC midnight AFTER its last
 * day. `normaliseRange` used to add a day on top of that exclusive end, so a
 * one-day event created through the API came back two days long; a PATCH
 * carrying only `startAt` (the month-grid drop) was stored raw, off
 * midnight, with the old `endAt` left behind.
 */
interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("events: all-day ranges are date-only with an exclusive end", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `events-allday-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    expect(workspaces.data).toHaveLength(1);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  type Ev = { id: string; startAt: string; endAt: string; allDay: boolean };

  it("keeps a one-day all-day event one day long and moves it by startAt alone", async () => {
    const s = await register("owner");
    const base = `/workspaces/${s.workspaceId}/events`;
    const created = await request<Ev>(base, {
      method: "POST",
      token: s.accessToken,
      body: { title: "День рождения", allDay: true, startAt: "2026-09-27T00:00:00.000Z", endAt: "2026-09-28T00:00:00.000Z" }
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    expect(created.data.startAt).toBe("2026-09-27T00:00:00.000Z");
    expect(created.data.endAt).toBe("2026-09-28T00:00:00.000Z");

    // A three-day event keeps exactly three days.
    const trip = await request<Ev>(base, {
      method: "POST",
      token: s.accessToken,
      body: { title: "Поездка", allDay: true, startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-04T00:00:00.000Z" }
    });
    expect(trip.data.endAt).toBe("2026-10-04T00:00:00.000Z");

    // startAt alone: moves the event, keeps its length, snaps to midnight.
    const moved = await request<Ev>(`${base}/${trip.data.id}`, {
      method: "PATCH",
      token: s.accessToken,
      body: { startAt: "2026-10-10T09:00:00.000Z" }
    });
    expect(moved.status, JSON.stringify(moved.data)).toBe(200);
    expect(moved.data.startAt).toBe("2026-10-10T00:00:00.000Z");
    expect(moved.data.endAt).toBe("2026-10-13T00:00:00.000Z");
  });

  it("moves a timed event by startAt alone without leaving endAt behind", async () => {
    const s = await register("timed");
    const base = `/workspaces/${s.workspaceId}/events`;
    const created = await request<Ev>(base, {
      method: "POST",
      token: s.accessToken,
      body: { title: "Созвон", startAt: "2026-09-27T15:00:00.000Z", endAt: "2026-09-27T16:30:00.000Z" }
    });
    expect(created.status).toBe(201);
    const moved = await request<Ev>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: s.accessToken,
      body: { startAt: "2026-09-30T15:00:00.000Z" }
    });
    expect(moved.data.startAt).toBe("2026-09-30T15:00:00.000Z");
    expect(moved.data.endAt).toBe("2026-09-30T16:30:00.000Z");
  });
});
