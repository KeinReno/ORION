import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { DomainEventBus } from "../src/domain-events/domain-event-bus";
import { DomainEventDispatcherService } from "../src/domain-events/domain-event-dispatcher.service";
import { MAX_DELIVERY_ATTEMPTS } from "../src/domain-events/delivery-policy";

interface Session {
  accessToken: string;
  userId: string;
  email: string;
  workspaceId: string;
}

const SUBSCRIBER_ID = "tasks.notify-assignee-on-close";

/** G3 / ADR-0019: outbox publish in the writer's transaction, dispatch, idempotency, disabled subscriber, RLS. */
describe("Domain event bus (outbox)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bus: DomainEventBus;
  let dispatcher: DomainEventDispatcherService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `g3-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    // These tests drive the dispatcher explicitly. A wall-clock cron between
    // publishing and taking the parent lock would make the lock-order case race.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    bus = app.get(DomainEventBus);
    dispatcher = app.get(DomainEventDispatcherService);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
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

  const payload = (id: string) => ({ id, projectId: null, assigneeId: null, status: "done" });
  const eventCount = (workspaceId: string) => prisma.asSystem((tx) => tx.domainEvent.count({ where: { workspaceId } }));
  const deliveryFor = (eventId: string) =>
    prisma.asSystem((tx) => tx.domainEventDelivery.findUniqueOrThrow({ where: { eventId_subscriberId: { eventId, subscriberId: SUBSCRIBER_ID } } }));

  it("publishes inside the caller's transaction: a rolled-back transaction publishes nothing, a committed one does", async () => {
    const alice = await register("alice-tx");
    await expect(
      prisma.withUser(alice.userId, async (tx) => {
        await bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", actorId: alice.userId, payload: payload("t1") });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await eventCount(alice.workspaceId)).toBe(0);

    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", actorId: alice.userId, payload: payload("t2") })
    );
    const row = await prisma.asSystem((tx) => tx.domainEvent.findUniqueOrThrow({ where: { id } }));
    expect(row).toMatchObject({ type: "tasks.task.closed", version: 1, actorId: alice.userId, dispatchedAt: null });

    // Payload is validated against the catalog schema.
    await expect(
      prisma.withUser(alice.userId, (tx) =>
        bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", payload: { id: 5 } as never })
      )
    ).rejects.toThrow();
  });

  it("closing a task publishes tasks.task.closed; the subscriber notifies the assignee once, and redelivery is idempotent", async () => {
    const alice = await register("alice-close");
    const bob = await register("bob-close");
    await joinAsMember(alice, bob);
    expect((await request(`/workspaces/${alice.workspaceId}/plugins/team`, { method: "PATCH", token: alice.accessToken, body: { enabled: true } })).status).toBe(200);
    const members = await request<Array<{ id: string; userId: string }>>(`/workspaces/${alice.workspaceId}/members`, { method: "GET", token: alice.accessToken });
    const bobMember = members.data.find((m) => m.userId === bob.userId)!;

    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Сдать отчёт", assigneeId: bobMember.id }
    });
    expect(task.status).toBe(201);
    const patched = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    expect(patched.status).toBe(200);

    const event = await prisma.asSystem((tx) => tx.domainEvent.findFirstOrThrow({ where: { workspaceId: alice.workspaceId, type: "tasks.task.closed" } }));
    expect(event.payload).toMatchObject({ id: task.data.id, assigneeId: bobMember.id, status: "done" });
    expect(event.actorId).toBe(alice.userId);

    await dispatcher.runOnce();
    const delivery = await deliveryFor(event.id);
    expect(delivery.status).toBe("done");
    expect(await closedNotifications(bob, alice.workspaceId)).toHaveLength(1);
    // The actor never notifies themself.
    expect(await closedNotifications(alice, alice.workspaceId)).toHaveLength(0);

    // Re-closing is not a transition: no second event.
    await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } });
    expect(await prisma.asSystem((tx) => tx.domainEvent.count({ where: { workspaceId: alice.workspaceId } }))).toBe(1);

    // Force a redelivery of the very same event: the handler runs again, the notification is not duplicated.
    await prisma.asSystem((tx) =>
      tx.domainEventDelivery.update({ where: { id: delivery.id }, data: { status: "pending", nextAttemptAt: new Date(0) } })
    );
    await dispatcher.runOnce();
    expect((await deliveryFor(event.id)).status).toBe("done");
    expect(await closedNotifications(bob, alice.workspaceId)).toHaveLength(1);
  });

  it("a disabled subscriber component neither breaks publishing nor gets the event later", async () => {
    const alice = await register("alice-off");
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["markets", "health", "tasks"] } }));
    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", actorId: alice.userId, payload: payload("t3") })
    );
    await dispatcher.runOnce();
    const delivery = await deliveryFor(id);
    expect(delivery.status).toBe("skipped_disabled");

    // Re-enabling does not replay: the skipped delivery stays skipped.
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["markets", "health"] } }));
    await dispatcher.runOnce();
    expect((await deliveryFor(id)).status).toBe("skipped_disabled");
  });

  it("a failing handler is retried with backoff and ends up failed after the attempt limit; publishing is unaffected", async () => {
    const alice = await register("alice-fail");
    const real = bus.subscriberById(SUBSCRIBER_ID)!;
    vi.spyOn(bus, "subscriberById").mockReturnValue({ ...real, handle: async () => { throw new Error("handler down"); } });
    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", actorId: alice.userId, payload: payload("t4") })
    );
    await dispatcher.runOnce();
    let delivery = await deliveryFor(id);
    expect(delivery).toMatchObject({ status: "pending", attempts: 1, lastError: "handler down" });
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Jump the clock past each backoff window until attempts are exhausted.
    for (let i = 1; i < MAX_DELIVERY_ATTEMPTS; i++) await dispatcher.runOnce(new Date(Date.now() + 24 * 3600_000 * i));
    delivery = await deliveryFor(id);
    expect(delivery).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
    vi.restoreAllMocks();
  });

  it("RLS: a user outside the workspace cannot read its outbox rows", async () => {
    const alice = await register("alice-rls");
    const carol = await register("carol-rls");
    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", actorId: alice.userId, payload: payload("t5") })
    );
    await dispatcher.runOnce();
    const own = await prisma.withUser(alice.userId, async (tx) => ({
      events: await tx.domainEvent.count({ where: { id } }),
      deliveries: await tx.domainEventDelivery.count({ where: { eventId: id } })
    }));
    expect(own).toEqual({ events: 1, deliveries: 1 });
    const foreign = await prisma.withUser(carol.userId, async (tx) => ({
      events: await tx.domainEvent.count({ where: { id } }),
      deliveries: await tx.domainEventDelivery.count({ where: { eventId: id } })
    }));
    expect(foreign).toEqual({ events: 0, deliveries: 0 });
    // And cannot publish into someone else's workspace.
    await expect(
      prisma.withUser(carol.userId, (tx) =>
        bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", payload: payload("t6") })
      )
    ).rejects.toThrow();
  });

  it("fan-out skips a locked parent before locking events, and resumes after rollback", async () => {
    const alice = await register("parent-lock");
    const bob = await register("unlocked-parent");
    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", payload: payload("locked-parent") })
    );
    const availableId = await prisma.withUser(bob.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: bob.workspaceId, type: "tasks.task.closed", payload: payload("available-parent") })
    );
    const rollback = new Error("rollback workspace deletion");
    await expect(prisma.asSystem(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${alice.workspaceId} FOR UPDATE`;
      // A second connection must finish without waiting for the parent lock.
      // Previously it locked the event, then waited on the delivery's parent FK;
      // cascading deletion here could then wait on that very event (40P01).
      await dispatcher.runOnce();
      expect((await deliveryFor(availableId)).status).toBe("done");
      expect(await tx.domainEventDelivery.count({ where: { eventId: id } })).toBe(0);
      expect((await tx.domainEvent.findUniqueOrThrow({ where: { id } })).dispatchedAt).toBeNull();
      await tx.workspace.delete({ where: { id: alice.workspaceId } });
      throw rollback;
    })).rejects.toBe(rollback);

    await Promise.all([dispatcher.runOnce(), dispatcher.runOnce()]);
    expect((await deliveryFor(id)).status).toBe("done");
    expect(await prisma.asSystem((tx) => tx.domainEventDelivery.count({ where: { eventId: id } }))).toBe(1);
  });

  it("workspace deletion can commit while fan-out skips its locked parent", async () => {
    const alice = await register("parent-delete");
    const id = await prisma.withUser(alice.userId, (tx) =>
      bus.publishTx(tx, { workspaceId: alice.workspaceId, type: "tasks.task.closed", payload: payload("deleted-parent") })
    );
    await prisma.asSystem(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${alice.workspaceId} FOR UPDATE`;
      await dispatcher.runOnce();
      await tx.workspace.delete({ where: { id: alice.workspaceId } });
    });
    await dispatcher.runOnce();
    expect(await prisma.asSystem((tx) => tx.domainEvent.count({ where: { id } }))).toBe(0);
    expect(await prisma.asSystem((tx) => tx.domainEventDelivery.count({ where: { eventId: id } }))).toBe(0);
  });

  async function closedNotifications(s: Session, workspaceId: string) {
    const res = await request<Array<{ title: string; kind: string }>>(`/workspaces/${workspaceId}/notifications`, { method: "GET", token: s.accessToken });
    return res.data.filter((n) => n.title.startsWith("Задача закрыта"));
  }

  async function joinAsMember(owner: Session, member: Session): Promise<void> {
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${owner.workspaceId}/invites`, { method: "POST", token: owner.accessToken, body: { email: member.email } });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${token}/accept`, { method: "POST", token: member.accessToken })).status).toBe(201);
  }

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, userId: response.data.user.id, email, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});
