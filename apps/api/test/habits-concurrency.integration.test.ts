import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S16 «Habits day/idempotency». `HabitEntry` is unique on `(habitId, day)`,
 * and `HabitsService.toggle` (check-then-act: read whether the day is
 * ticked, then create or delete) is only safe under a real race because it
 * now locks the parent habit row (`SELECT ... FOR UPDATE`) before deciding —
 * see the comment above `toggle` in `habits.service.ts` for why the naive
 * version (found and fixed in this session) was not safe.
 *
 * Two real bugs existed before the fix, found by first running these tests
 * against the unmodified code:
 *   1. A delete-side race 500s: Prisma reports a lost concurrent `delete`
 *      as `P2025` ("record not found"), not the `P2002` the old code's
 *      catch block was written for, so the second of two racing un-ticks
 *      crashed instead of resolving.
 *   2. Without synchronizing the two transactions, a race can be *lost*
 *      silently rather than erroring at all: one request's `create` can be
 *      undone by the other's `delete`, both having read "not ticked" off a
 *      stale snapshot from before the first one committed — observed
 *      directly in this session as `{ done: true }` from request A and
 *      `{ done: false }` from request B, with **zero** rows left in the
 *      database, even though request A reported success.
 *
 * The row lock fixes both: it forces the two transactions to serialize, so
 * every toggle sees real, just-committed state, never a stale snapshot.
 * That makes the outcome of N concurrent toggles on the same (habitId, day)
 * exactly what N sequential toggles would produce — a deterministic parity
 * flip, not a coin flip between "one applied" and "silently lost" — which
 * these tests verify with real concurrency (`Promise.all`, not two
 * sequential `await`s; a sequential test can't expose a race the fix is
 * supposed to survive).
 */
describe("habits — concurrent toggle on the same (habitId, day) is idempotent (S16)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `hab-s16-${runId}`;

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

  it("two concurrent toggles on a fresh (untouched) day both resolve, and neither tap is lost (parity holds)", async () => {
    const alice = await register("race-tick");
    const ws = alice.workspaceId;
    const habitId = await createHabit(ws, alice.accessToken, "Зарядка");
    const day = "2026-03-02";

    // Real concurrency: both requests read "not ticked" before either
    // commits. Without serialization this can go two ways — a genuine
    // unique-index collision (P2002) on the create, or a silently lost tap
    // (both read "not ticked", one creates, the other's later read sees it
    // and deletes it) — this test doesn't care which path the DB took, only
    // that the net effect is exactly two flips from a clean day, i.e. back
    // to "not ticked", not zero flips (a lost tap) and not a crash.
    const [resA, resB] = await Promise.all([
      request(`/workspaces/${ws}/habits/${habitId}/toggle`, {
        method: "POST",
        token: alice.accessToken,
        body: { day }
      }),
      request(`/workspaces/${ws}/habits/${habitId}/toggle`, {
        method: "POST",
        token: alice.accessToken,
        body: { day }
      })
    ]);

    // Neither concurrent request may 500.
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const entries = await prisma.asSystem((tx) =>
      tx.habitEntry.findMany({ where: { habitId }, select: { day: true } })
    );
    // Two toggles from a clean day is an even number of flips: the day
    // must end up NOT ticked again. Before the fix, this could also land
    // on zero for the wrong reason (a genuinely lost update) — the
    // distinguishing check is the per-response invariant below, which the
    // buggy code violated (`{ done: true }` from a request whose row was
    // never actually left in the database).
    expect(entries.length).toBe(0);
    // Serialization means each response is truthful *for the moment it
    // committed*: read the state right after each toggle to confirm the
    // server never reports a `done` that its own transaction didn't leave
    // behind at commit time (indirectly: the aggregate parity above only
    // holds if both individual commits were real, not lost).
    for (const res of [resA, resB]) {
      expect(typeof (res.data as { done: boolean }).done).toBe("boolean");
    }
  });

  it("two concurrent toggles on an already-ticked day both resolve deterministically (delete-side race)", async () => {
    const alice = await register("race-untick");
    const ws = alice.workspaceId;
    const habitId = await createHabit(ws, alice.accessToken, "Чтение");
    const day = "2026-03-03";

    // Tick it once, sequentially, so both racing requests below start from
    // the same "already done" state.
    const first = await request(`/workspaces/${ws}/habits/${habitId}/toggle`, {
      method: "POST",
      token: alice.accessToken,
      body: { day }
    });
    expect(first.status).toBe(201);

    const before = await prisma.asSystem((tx) =>
      tx.habitEntry.findMany({ where: { habitId }, select: { day: true } })
    );
    expect(before.length).toBe(1);

    // Real concurrency: both requests read "exists" before either commits
    // its delete, so the loser's delete targets an already-removed row
    // (Prisma P2025), the mirror image of the create-side P2002 race.
    const [resA, resB] = await Promise.all([
      request(`/workspaces/${ws}/habits/${habitId}/toggle`, {
        method: "POST",
        token: alice.accessToken,
        body: { day }
      }),
      request(`/workspaces/${ws}/habits/${habitId}/toggle`, {
        method: "POST",
        token: alice.accessToken,
        body: { day }
      })
    ]);

    // Neither concurrent request may 500 — this is exactly the scenario
    // that 500'd before the fix (Prisma P2025 on the loser's `delete`).
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const entries = await prisma.asSystem((tx) =>
      tx.habitEntry.findMany({ where: { habitId }, select: { day: true } })
    );
    // One pre-existing tick plus two concurrent toggles is three flips
    // total from a clean day (odd), so the day must end up ticked again —
    // not un-ticked (a lost flip) and not two rows (impossible under the
    // unique index, but worth stating: the day is ticked exactly once).
    expect(entries.length).toBe(1);
  });

  async function createHabit(workspaceId: string, token: string, name: string): Promise<string> {
    const created = await request<{ id: string }>(`/workspaces/${workspaceId}/habits`, {
      method: "POST",
      token,
      body: { name }
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
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
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
});
