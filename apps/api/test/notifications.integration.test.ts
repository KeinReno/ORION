import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { DueTaskCheckerService } from "../src/notifications/due-task-checker.service";
import { configureApp } from "../src/configure-app";

/**
 * S07 «Адресные уведомления». Notification rows are now addressed
 * (`recipientId`) instead of shared across the whole workspace — this
 * covers every done-criterion from docs/SONNET_IMPLEMENTATION/10-BACKLOG.md:
 * independent per-recipient read state, repeated-cron dedup via `eventKey`,
 * revoked members never becoming a recipient, and the recipient's own
 * quiet hours (not the owner's, not the actor's) governing delivery.
 */
describe("notifications — addressed recipients (S07)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dueChecker: DueTaskCheckerService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `notif-s07-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    dueChecker = app.get(DueTaskCheckerService);
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

  it("S07: A reading a notification leaves B's copy of the same event unread (independent per-recipient read state)", async () => {
    const alice = await register("read-alice");
    const bob = await register("read-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "read-bob");

    // Simulate a producer fan-out: same event, two addressed rows — this is
    // exactly what "per-user read state" means (there is no shared row).
    const eventKey = `test_event:${runId}`;
    const { aliceNotifId, bobNotifId } = await prisma.asSystem(async (tx) => {
      const a = await tx.notification.create({
        data: { workspaceId: ws, recipientId: alice.user.id, kind: "system", title: "t", body: "b", eventKey: `${eventKey}:alice` }
      });
      const b = await tx.notification.create({
        data: { workspaceId: ws, recipientId: bob.user.id, kind: "system", title: "t", body: "b", eventKey: `${eventKey}:bob` }
      });
      return { aliceNotifId: a.id, bobNotifId: b.id };
    });

    const markRead = await request(`/workspaces/${ws}/notifications/${aliceNotifId}/read`, {
      method: "PATCH",
      token: alice.accessToken
    });
    expect(markRead.status).toBe(200);

    const bobList = await request<Array<{ id: string; readAt: string | null }>>(`/workspaces/${ws}/notifications`, {
      method: "GET",
      token: bob.accessToken
    });
    const bobRow = bobList.data.find((n) => n.id === bobNotifId);
    expect(bobRow?.readAt).toBeNull();

    // B never even sees A's row — it isn't addressed to them.
    expect(bobList.data.find((n) => n.id === aliceNotifId)).toBeUndefined();
  });

  it("S07: B cannot mark A's notification read (recipient-scoped, not workspace-scoped)", async () => {
    const alice = await register("scope-alice");
    const bob = await register("scope-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "scope-bob");

    const aliceNotifId = await prisma.asSystem(async (tx) => {
      const row = await tx.notification.create({
        data: { workspaceId: ws, recipientId: alice.user.id, kind: "system", title: "t", body: "b" }
      });
      return row.id;
    });

    const bobTriesToRead = await request(`/workspaces/${ws}/notifications/${aliceNotifId}/read`, {
      method: "PATCH",
      token: bob.accessToken
    });
    expect(bobTriesToRead.status).toBe(404);
  });

  it("S07: repeated DueTaskCheckerService.runCheck() does not duplicate the notification for the same task", async () => {
    const alice = await register("cron-dedup-alice");
    const ws = alice.workspaceId;

    const taskId = await createOverdueTask(ws, alice.accessToken);

    const first = await dueChecker.runCheck();
    expect(first.notified).toBeGreaterThanOrEqual(1);

    // notifiedAt is set by the first run, so a naive test would trivially
    // "pass" by never re-evaluating the task at all — reset it to force the
    // second run to actually re-attempt this task's notification, and prove
    // dedup is the eventKey unique index, not just the notifiedAt guard.
    await prisma.asSystem((tx) => tx.task.update({ where: { id: taskId }, data: { notifiedAt: null } }));

    const second = await dueChecker.runCheck();
    expect(second.notified).toBeGreaterThanOrEqual(1); // the checker still "counts" it as processed

    const rows = await prisma.asSystem((tx) =>
      tx.notification.findMany({ where: { workspaceId: ws, entityType: "task", entityId: taskId } })
    );
    expect(rows).toHaveLength(1);
  });

  it("S07: removing a member before the cron runs means they never become the recipient (falls back to owner)", async () => {
    const alice = await register("revoke-alice");
    const bob = await register("revoke-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "revoke-bob");

    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: ws }, data: { pluginOverrides: ["team"] } }));
    const bobMemberId = await prisma.asSystem(async (tx) => {
      const m = await tx.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws, userId: bob.user.id } } });
      return m.id;
    });

    const taskId = await createOverdueTask(ws, alice.accessToken, { assigneeId: bobMemberId });

    // Bob is removed from the workspace before the cron ever looks at it.
    const membersList = await request<Array<{ id: string; userId: string }>>(`/workspaces/${ws}/members`, { method: "GET", token: alice.accessToken });
    const bobMember = membersList.data.find((m) => m.userId === bob.user.id)!;
    const removed = await request(`/workspaces/${ws}/members/${bobMember.id}`, { method: "DELETE", token: alice.accessToken });
    expect(removed.status).toBe(200);

    await dueChecker.runCheck();

    const rows = await prisma.asSystem((tx) =>
      tx.notification.findMany({ where: { workspaceId: ws, entityType: "task", entityId: taskId } })
    );
    expect(rows.every((r) => r.recipientId !== bob.user.id)).toBe(true);
    // Falls back to the still-present owner instead of being lost silently.
    expect(rows.some((r) => r.recipientId === alice.user.id)).toBe(true);
  });

  it("S07: quiet hours are the ADDRESSEE's — an assignee's quiet hours suppress delivery even though the owner (not in quiet hours) created the task", async () => {
    const alice = await register("quiet-alice");
    const bob = await register("quiet-bob");
    const ws = alice.workspaceId;
    await inviteAndJoin(ws, alice.accessToken, bob, "quiet-bob");
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: ws }, data: { pluginOverrides: ["team"] } }));
    const bobMemberId = await prisma.asSystem(async (tx) => {
      const m = await tx.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws, userId: bob.user.id } } });
      return m.id;
    });

    // Bob's quiet hours cover the entire day (00:00-23:59) — any moment is "quiet" for him.
    await prisma.asSystem((tx) =>
      tx.userPreference.upsert({
        where: { userId: bob.user.id },
        create: { userId: bob.user.id, quietHoursStart: "00:00", quietHoursEnd: "23:59", timeZone: "UTC" },
        update: { quietHoursStart: "00:00", quietHoursEnd: "23:59", timeZone: "UTC" }
      })
    );
    // Alice (owner, the actor who'd otherwise be the fallback recipient) has NO quiet hours.
    await prisma.asSystem((tx) =>
      tx.userPreference.upsert({
        where: { userId: alice.user.id },
        create: { userId: alice.user.id },
        update: { quietHoursStart: null, quietHoursEnd: null }
      })
    );

    const taskId = await createOverdueTask(ws, alice.accessToken, { assigneeId: bobMemberId });

    const result = await dueChecker.runCheck();
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const rows = await prisma.asSystem((tx) =>
      tx.notification.findMany({ where: { workspaceId: ws, entityType: "task", entityId: taskId } })
    );
    expect(rows).toHaveLength(0);

    // notifiedAt stays null — this is a suppressed-until-later reminder, not a
    // lost one (CLAUDE.md invariant #8).
    const task = await prisma.asSystem((tx) => tx.task.findUniqueOrThrow({ where: { id: taskId } }));
    expect(task.notifiedAt).toBeNull();
  });

  it("S07: NotificationCenterService.createTx skips silently when actorId equals recipientId (self-action never notifies you about yourself)", async () => {
    const alice = await register("self-alice");
    const ws = alice.workspaceId;

    const { NotificationCenterService } = await import("../src/notifications/notification-center.service");
    const center = app.get(NotificationCenterService);

    const result = await prisma.asSystem((tx) =>
      center.createTx(tx, {
        workspaceId: ws,
        recipientId: alice.user.id,
        actorId: alice.user.id,
        kind: "system",
        title: "self action",
        body: "should not be created"
      })
    );
    expect(result).toBeNull();

    const rows = await prisma.asSystem((tx) => tx.notification.findMany({ where: { workspaceId: ws, title: "self action" } }));
    expect(rows).toHaveLength(0);
  });

  async function createOverdueTask(
    workspaceId: string,
    token: string,
    extra: { assigneeId?: string } = {}
  ): Promise<string> {
    const created = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
      method: "POST",
      token,
      body: { title: `overdue ${runId}`, dueAt: new Date(Date.now() - 60_000).toISOString(), ...extra }
    });
    expect(created.status).toBe(201);
    return created.data.id;
  }

  async function register(name: string): Promise<{ accessToken: string; user: { id: string }; workspaceId: string }> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
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
