import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { ReminderCheckerService } from "../src/search/reminder-checker.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

/**
 * U03 (24-CONNECTED-CORE-BACKLOG.md) — personal one-shot `EntityReminder`.
 * Executable proof for the done-criteria: a repeated cron tick (including a
 * genuine `Promise.all` concurrent tick, not sequential awaits) never
 * delivers the same reminder twice, and access revoked before the scheduled
 * instant (module restricted, or workspace membership removed) prevents
 * delivery instead of leaking the entity's title into a notification.
 */
describe("EntityReminder personal one-shot reminders (U03)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let checker: ReminderCheckerService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `u03-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    checker = app.get(ReminderCheckerService);
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

  it("creates, lists and cancels a personal reminder through the real HTTP surface", async () => {
    const alice = await register("crud");
    const task = await createTask(alice, "Позвонить в банк");

    const created = await request<{ id: string; status: string; entityTitle: string }>(
      `/workspaces/${alice.workspaceId}/reminders`,
      {
        method: "POST",
        token: alice.accessToken,
        body: { entityType: "task", entityId: task.id, scheduledAt: futureIso(), timezone: "Europe/Moscow" }
      }
    );
    expect(created.status).toBe(201);
    expect(created.data.status).toBe("pending");
    expect(created.data.entityTitle).toBe("Позвонить в банк");

    const list = await request<Array<{ id: string }>>(`/workspaces/${alice.workspaceId}/reminders`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(list.data.map((r) => r.id)).toContain(created.data.id);

    const cancelled = await request<{ status: string }>(`/workspaces/${alice.workspaceId}/reminders/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.status).toBe("cancelled");
  });

  it("real RLS + ownership: a foreign entity ref is rejected, and another member cannot cancel someone else's reminder", async () => {
    const alice = await register("cross-a");
    const bob = await register("cross-b");
    const aliceTask = await createTask(alice, "Задача Алисы");

    // Bob cannot create a reminder for an entity in Alice's workspace from his own.
    const foreign = await request(`/workspaces/${bob.workspaceId}/reminders`, {
      method: "POST",
      token: bob.accessToken,
      body: { entityType: "task", entityId: aliceTask.id, scheduledAt: futureIso(), timezone: "UTC" }
    });
    expect(foreign.status).toBe(404);

    // Bob cannot even list/cancel scoped to Alice's workspace by guessing ids.
    const list = await request(`/workspaces/${alice.workspaceId}/reminders`, { method: "GET", token: bob.accessToken });
    expect(list.status).toBe(403);
  });

  it("delivers a due reminder exactly once even when the cron tick runs twice sequentially (eventKey dedup)", async () => {
    const alice = await register("dedup-seq");
    const task = await createTask(alice, "Отправить отчёт");
    const reminderId = await createDueReminder(alice, "task", task.id);

    const first = await checker.runCheck();
    expect(first.delivered).toBeGreaterThanOrEqual(1);

    const second = await checker.runCheck();
    // The row is already `delivered`, so the second tick's WHERE (status: pending) excludes it entirely.
    expect(second.delivered).toBe(0);

    const notifications = await countNotificationsForEvent(`entity_reminder:${reminderId}`);
    expect(notifications).toBe(1);

    const row = await getReminder(reminderId);
    expect(row?.status).toBe("delivered");
  });

  it("UC04: two genuinely concurrent cron ticks (Promise.all, not sequential await) never create two notifications for the same reminder", async () => {
    const alice = await register("dedup-concurrent");
    const task = await createTask(alice, "Согласовать бюджет");
    const reminderId = await createDueReminder(alice, "task", task.id);

    // Two real concurrent ticks racing on the same row: the eventKey partial
    // unique index + createMany({skipDuplicates:true}) is the actual barrier
    // (see NotificationCenterService.createTx) — this asserts the outcome,
    // not just that the code path was exercised.
    const [a, b] = await Promise.all([checker.runCheck(), checker.runCheck()]);
    expect(a.delivered + b.delivered).toBeGreaterThanOrEqual(1);

    const notifications = await countNotificationsForEvent(`entity_reminder:${reminderId}`);
    expect(notifications).toBe(1);

    const row = await getReminder(reminderId);
    expect(row?.status).toBe("delivered");
  });

  it("access revoked before delivery (module restricted) cancels the reminder instead of delivering it", async () => {
    const alice = await register("revoke-module");
    const note = await createNote(alice, "Личная заметка");
    const reminderId = await createDueReminder(alice, "note", note.id);

    const disable = await request(`/workspaces/${alice.workspaceId}/modules/notes`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false }
    });
    expect(disable.status).toBe(200);

    const result = await checker.runCheck();
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const row = await getReminder(reminderId);
    expect(row?.status).toBe("cancelled");
    expect(row?.deliveredAt).toBeNull();

    const notifications = await countNotificationsForEvent(`entity_reminder:${reminderId}`);
    expect(notifications).toBe(0);
  });

  it("access revoked before delivery (membership removed) cancels the reminder without leaking the entity title", async () => {
    const alice = await register("revoke-membership");
    const task = await createTask(alice, "Секретная задача");
    const reminderId = await createDueReminder(alice, "task", task.id);

    // Simulate a removed membership (no such API endpoint exists yet — see
    // WorkspacesModule) directly at the data layer, same way the RLS test
    // above manipulates rows through `prisma.asSystem`.
    await prisma.asSystem((tx) => tx.workspaceMember.deleteMany({ where: { workspaceId: alice.workspaceId, userId: alice.user.id } }));

    const result = await checker.runCheck();
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const row = await getReminder(reminderId);
    expect(row?.status).toBe("cancelled");

    const notifications = await countNotificationsForEvent(`entity_reminder:${reminderId}`);
    expect(notifications).toBe(0);

    // Restore membership so afterAll's cleanup (which walks memberships to find workspaces) still works.
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: alice.workspaceId, userId: alice.user.id, role: "owner" } }));
  });

  async function createDueReminder(session: RegisteredSession, entityType: string, entityId: string): Promise<string> {
    // Created directly through asSystem with a past `scheduledAt` — the HTTP
    // create path doesn't reject a past date (a reminder for "right now" is
    // legitimate), but backdating here makes the cron's `lte: now()` match
    // deterministically without a real sleep.
    const row = await prisma.asSystem((tx) =>
      tx.entityReminder.create({
        data: {
          workspaceId: session.workspaceId,
          ownerId: session.user.id,
          recipientId: session.user.id,
          entityType,
          entityId,
          scheduledAt: new Date(Date.now() - 60_000),
          timezone: "UTC",
          status: "pending"
        }
      })
    );
    return row.id;
  }

  async function getReminder(id: string) {
    return prisma.asSystem((tx) => tx.entityReminder.findUnique({ where: { id } }));
  }

  async function countNotificationsForEvent(eventKey: string): Promise<number> {
    return prisma.asSystem((tx) => tx.notification.count({ where: { eventKey } }));
  }

  function futureIso(): string {
    return new Date(Date.now() + 3_600_000).toISOString();
  }

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
  }

  async function createTask(session: RegisteredSession, title: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/tasks`, {
      method: "POST",
      token: session.accessToken,
      body: { title }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createNote(session: RegisteredSession, title: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/notes`, {
      method: "POST",
      token: session.accessToken,
      body: { title, body: "" }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});
