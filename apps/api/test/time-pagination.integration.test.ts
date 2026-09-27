import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S15 — "Полнота списков и отчётов", time entries slice.
 *
 * Reproduces the exact bug the backlog card names: `TimeService.list` used to
 * be a flat `findMany({ take: 500 })` with no way to see row 501+ and no
 * server-side total, so the panel's "Всего" was a client-side sum over
 * whatever page happened to load — silently wrong past 500 rows, with no
 * error and no signal that anything was cut.
 *
 * This suite bulk-inserts real rows directly via Prisma (not 500 API calls)
 * against the isolated test Postgres, then asserts:
 *  1. `TimeService.summary` returns an exact total for >500 rows.
 *  2. `TimeService.list` pages through the full set with a filter applied —
 *     no duplicates, no gaps, exact count.
 *  3. A cursor id from workspace B is rejected when paging workspace A (not
 *     silently ignored, not leaked into A's ordering).
 */
interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("S15: time entries — exact totals and cursor pagination", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `s15-time-${runId}`;

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
      // Same cleanup discipline as api-rls.integration.test.ts: deleting the
      // user alone leaves the workspace (and every bulk-inserted row) behind.
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

  /**
   * Bulk-inserts `count` closed entries of exactly `minutesEach` minutes,
   * `stepMs` apart, directly via Prisma — the acceptance criterion explicitly
   * calls for bulk Prisma insert, not hundreds of API round-trips. Bypasses
   * RLS via `asSystem` the same way other integration tests seed fixtures;
   * this is fixture setup, not the code path under test.
   */
  async function seedEntries(
    workspaceId: string,
    userId: string,
    count: number,
    minutesEach: number,
    startAt: Date,
    stepMs: number
  ): Promise<void> {
    const rows = Array.from({ length: count }, (_, i) => {
      const startedAt = new Date(startAt.getTime() + i * stepMs);
      const endedAt = new Date(startedAt.getTime() + minutesEach * 60_000);
      return { workspaceId, userId, note: `bulk-${i}`, startedAt, endedAt };
    });
    await prisma.asSystem((tx) => tx.timeEntry.createMany({ data: rows }));
  }

  it("summary total is exact for >500 entries (server-side aggregate, not a page sum)", async () => {
    const alice = await register("alice-summary");
    const COUNT = 620;
    const MINUTES_EACH = 15;
    // Far enough in the past that "today"/"week" windows in the panel never
    // collide with this fixture — one clean deterministic window.
    const start = new Date("2020-01-01T00:00:00.000Z");
    await seedEntries(alice.workspaceId, alice.user.id, COUNT, MINUTES_EACH, start, 60_000);

    const summary = await request<{ minutes: number; count: number }>(
      `/workspaces/${alice.workspaceId}/time/summary?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z`,
      { method: "GET", token: alice.accessToken }
    );
    expect(summary.status).toBe(200);
    expect(summary.data.count).toBe(COUNT);
    expect(summary.data.minutes).toBe(COUNT * MINUTES_EACH);

    // The old behaviour this replaces: a single `list` page capped well below
    // 620 rows. Prove the default page is in fact smaller than the total, so
    // the summary total is doing real work, not just echoing a full page.
    const firstPage = await request<{ items: unknown[]; nextCursor: string | null }>(
      `/workspaces/${alice.workspaceId}/time?from=2020-01-01T00:00:00.000Z&to=2020-02-01T00:00:00.000Z`,
      { method: "GET", token: alice.accessToken }
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.data.items.length).toBeLessThan(COUNT);
    expect(firstPage.data.nextCursor).not.toBeNull();
  });

  it("pages through a filtered set with zero duplicates and zero gaps", async () => {
    const bob = await register("bob-paging");
    const COUNT = 347;
    const start = new Date("2021-06-01T00:00:00.000Z");
    await seedEntries(bob.workspaceId, bob.user.id, COUNT, 5, start, 120_000);

    const seenIds = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query = new URLSearchParams({ from: "2021-06-01T00:00:00.000Z", to: "2021-07-01T00:00:00.000Z", limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const page = await request<{ items: { id: string }[]; nextCursor: string | null }>(
        `/workspaces/${bob.workspaceId}/time?${query.toString()}`,
        { method: "GET", token: bob.accessToken }
      );
      expect(page.status).toBe(200);
      for (const item of page.data.items) {
        expect(seenIds.has(item.id)).toBe(false); // no duplicates
        seenIds.add(item.id);
      }
      cursor = page.data.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThan(50); // sanity bound against an infinite loop bug
    } while (cursor);

    expect(seenIds.size).toBe(COUNT); // no gaps either
  });

  it("rejects a cursor id from another workspace instead of leaking into this one's ordering", async () => {
    const carol = await register("carol-cursor-a");
    const dave = await register("dave-cursor-b");
    await seedEntries(carol.workspaceId, carol.user.id, 5, 10, new Date("2022-01-01T00:00:00.000Z"), 60_000);
    await seedEntries(dave.workspaceId, dave.user.id, 5, 10, new Date("2022-01-01T00:00:00.000Z"), 60_000);

    const daveList = await request<{ items: { id: string }[] }>(`/workspaces/${dave.workspaceId}/time`, {
      method: "GET",
      token: dave.accessToken
    });
    expect(daveList.status).toBe(200);
    const foreignCursor = daveList.data.items[0]!.id;

    // Carol pages her own workspace with Dave's row id as the cursor.
    const rejected = await request(`/workspaces/${carol.workspaceId}/time?cursor=${foreignCursor}`, {
      method: "GET",
      token: carol.accessToken
    });
    expect(rejected.status).toBe(400);
  });
});
