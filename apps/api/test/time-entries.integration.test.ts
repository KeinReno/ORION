import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S06 «Личные таймеры». Проверяет инвариант, который был неверным до этой
 * миграции: "один запущенный таймер на workspace" (было) → "один запущенный
 * таймер на (workspace, user)" (стало). Команда и соло — равноправные
 * сценарии (CLAUDE.md), поэтому A не должен блокировать таймер B в одном
 * пространстве, но одна и та же личность не должна получить два таймера в
 * одном пространстве даже при гонке двух вкладок.
 */
describe("time entries — per-user running timer (S06)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `time-s06-${runId}`;

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
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  it("lets A and B each run their own timer in the same workspace at once (concurrent, not sequential)", async () => {
    const alice = await register("conc-alice");
    const bob = await register("conc-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "conc-bob");

    // Real concurrency: both start requests fired together, not two awaited
    // one after another — a sequential test cannot expose a race the DB
    // constraint is supposed to catch (or fail to catch).
    const [aStart, bStart] = await Promise.all([
      request(`/workspaces/${ws}/time/start`, { method: "POST", token: alice.accessToken, body: { note: "A working" } }),
      request(`/workspaces/${ws}/time/start`, { method: "POST", token: bob.accessToken, body: { note: "B working" } })
    ]);

    expect(aStart.status).toBe(201);
    expect(bStart.status).toBe(201);

    const aRunning = await request(`/workspaces/${ws}/time/running`, { method: "GET", token: alice.accessToken });
    const bRunning = await request(`/workspaces/${ws}/time/running`, { method: "GET", token: bob.accessToken });
    expect((aRunning.data as { id: string } | null)?.id).toBe((aStart.data as { id: string }).id);
    expect((bRunning.data as { id: string } | null)?.id).toBe((bStart.data as { id: string }).id);

    // B stopping their own timer must not touch A's.
    const bStop = await request(`/workspaces/${ws}/time/stop`, { method: "POST", token: bob.accessToken, body: {} });
    expect(bStop.status).toBe(201);
    const aStillRunning = await request(`/workspaces/${ws}/time/running`, { method: "GET", token: alice.accessToken });
    expect((aStillRunning.data as { id: string } | null)?.id).toBe((aStart.data as { id: string }).id);

    await request(`/workspaces/${ws}/time/stop`, { method: "POST", token: alice.accessToken, body: {} });
  });

  it("rejects a second concurrent start for the SAME identity in the same workspace with 409, not a second row", async () => {
    const alice = await register("conc-self");
    const ws = alice.workspaceId;

    // Two tabs of the same user pressing "Старт" at the same instant.
    const results = await Promise.all([
      request(`/workspaces/${ws}/time/start`, { method: "POST", token: alice.accessToken, body: { note: "tab 1" } }),
      request(`/workspaces/${ws}/time/start`, { method: "POST", token: alice.accessToken, body: { note: "tab 2" } })
    ]);

    const statuses = results.map((r) => r.status).sort();
    // Exactly one succeeds, the other is a 409 conflict (P2002 translated by TimeService).
    expect(statuses).toEqual([201, 409]);

    const running = await request(`/workspaces/${ws}/time/running`, { method: "GET", token: alice.accessToken });
    expect(running.status).toBe(200);
    expect(running.data).not.toBeNull();

    // No orphan second running row was left behind despite the race.
    const list = await request<{ items: Array<{ endedAt: string | null }>; nextCursor: string | null }>(
      `/workspaces/${ws}/time`,
      { method: "GET", token: alice.accessToken }
    );
    const runningCount = list.data.items.filter((e) => e.endedAt === null).length;
    expect(runningCount).toBe(1);

    await request(`/workspaces/${ws}/time/stop`, { method: "POST", token: alice.accessToken, body: {} });
  });

  it("B cannot stop or see A's running timer as their own", async () => {
    const alice = await register("guard-alice");
    const bob = await register("guard-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "guard-bob");

    const aStart = await request<{ id: string }>(`/workspaces/${ws}/time/start`, {
      method: "POST",
      token: alice.accessToken,
      body: { note: "A only" }
    });
    expect(aStart.status).toBe(201);

    const bRunning = await request(`/workspaces/${ws}/time/running`, { method: "GET", token: bob.accessToken });
    expect(bRunning.data).toBeNull();

    const bStop = await request(`/workspaces/${ws}/time/stop`, { method: "POST", token: bob.accessToken, body: {} });
    expect(bStop.status).toBe(404);

    await request(`/workspaces/${ws}/time/stop`, { method: "POST", token: alice.accessToken, body: {} });
  });

  it("marks legacy author-unknown rows correctly in DTOs and keeps them out of both mine/team totals", async () => {
    const alice = await register("legacy-alice");
    const ws = alice.workspaceId;

    // Simulate a pre-S06 row: userId left null, exactly what the migration
    // does NOT backfill.
    await prisma.asSystem(async (tx) => {
      const started = new Date(Date.now() - 3600_000);
      await tx.timeEntry.create({
        data: { workspaceId: ws, userId: null, note: "legacy", startedAt: started, endedAt: new Date() }
      });
    });

    const list = await request<{ items: Array<{ userId: string | null; mine: boolean }>; nextCursor: string | null }>(
      `/workspaces/${ws}/time`,
      { method: "GET", token: alice.accessToken }
    );
    const legacy = list.data.items.find((e) => e.userId === null);
    expect(legacy).toBeDefined();
    expect(legacy?.mine).toBe(false);
  });

  async function register(name: string): Promise<{ accessToken: string; user: { id: string }; workspaceId: string }> {
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
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function inviteAndJoin(
    workspaceId: string,
    ownerToken: string,
    joiner: { accessToken: string; user: { id: string } },
    joinerName: string
  ): Promise<void> {
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: ownerToken,
      body: { email: `${emailPrefix}-${joinerName}@example.test` }
    });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token: joiner.accessToken });
    expect(accepted.status).toBe(201);
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
});
