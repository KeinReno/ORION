import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S14a — "cascade preview" for the project plan (U04 acceptance scenario:
 * "Сдвинуть A, увидеть preview каскада и применить"). `MilestonesService.
 * update` finish-to-start reschedules dependent milestones silently on
 * commit (`cascadeRescheduleTx`) — a Gantt drag could therefore move
 * milestones the user never touched with zero visibility. This adds a
 * read-only `POST .../milestones/:id/reschedule-preview` that simulates the
 * same walk against hypothetical dates without writing anything, so the UI
 * can show "will also move: …" before the PATCH commits it.
 *
 * Regression this guards: before S14a, the only way to discover a cascade
 * was to apply the PATCH and diff the milestone list — there was no
 * preview endpoint at all, so an agent tempted to "helpfully" have preview
 * silently double-apply the cascade (once via preview, once via the real
 * PATCH) is exactly the bug the read-only assertions below catch.
 */
describe("Milestones — cascade preview (S14a)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `milestones-cascade-${runId}`;

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

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  interface MilestoneDto {
    id: string;
    title: string;
    startAt: string | null;
    dueAt: string | null;
  }
  interface CascadeImpact {
    milestoneId: string;
    title: string;
    previousStartAt: string | null;
    previousDueAt: string | null;
    nextStartAt: string | null;
    nextDueAt: string | null;
  }

  async function makeProjectPlan(token: string, workspaceId: string) {
    const project = await request<{ id: string }>(`/workspaces/${workspaceId}/projects`, {
      method: "POST",
      token,
      body: { name: `Plan ${Math.random().toString(36).slice(2)}` }
    });
    expect(project.status).toBe(201);
    const projectId = project.data.id;

    const day = (n: number) => new Date(Date.UTC(2027, 0, n)).toISOString();

    const a = await request<MilestoneDto>(`/workspaces/${workspaceId}/milestones`, {
      method: "POST",
      token,
      body: { projectId, title: "A", startAt: day(1), dueAt: day(5), order: 0 }
    });
    expect(a.status).toBe(201);

    const b = await request<MilestoneDto>(`/workspaces/${workspaceId}/milestones`, {
      method: "POST",
      token,
      body: { projectId, title: "B", startAt: day(5), dueAt: day(10), order: 1, dependencyIds: [a.data.id] }
    });
    expect(b.status).toBe(201);

    const c = await request<MilestoneDto>(`/workspaces/${workspaceId}/milestones`, {
      method: "POST",
      token,
      body: { projectId, title: "C", startAt: day(10), dueAt: day(15), order: 2, dependencyIds: [b.data.id] }
    });
    expect(c.status).toBe(201);

    return { workspaceId, projectId, a: a.data, b: b.data, c: c.data, day };
  }

  it("preview reports B and C moving when A is pushed out, and applying does not double-shift them", async () => {
    const alice = await register("alice");
    const { workspaceId, a, b, c, day } = await makeProjectPlan(alice.accessToken, alice.workspaceId);

    // Push A forward by 20 days: A now finishes on day 25, well past B's
    // current start (day 5) and C's (day 10) — both should cascade.
    const newAStart = day(21);
    const newADue = day(25);

    const preview = await request<CascadeImpact[]>(`/workspaces/${workspaceId}/milestones/${a.id}/reschedule-preview`, {
      method: "POST",
      token: alice.accessToken,
      body: { startAt: newAStart, dueAt: newADue }
    });
    expect(preview.status).toBe(201);
    const impacts = preview.data;
    expect(impacts.map((i) => i.milestoneId).sort()).toEqual([b.id, c.id].sort());

    const bImpact = impacts.find((i) => i.milestoneId === b.id);
    const cImpact = impacts.find((i) => i.milestoneId === c.id);
    expect(bImpact?.previousStartAt).toBe(b.startAt);
    expect(bImpact?.nextStartAt).toBe(newADue); // B's start is pinned to A's new due (finish-to-start)
    // B's original 5-day duration (day 5 → day 10) is preserved.
    expect(new Date(bImpact!.nextDueAt!).getTime() - new Date(bImpact!.nextStartAt!).getTime()).toBe(
      new Date(b.dueAt!).getTime() - new Date(b.startAt!).getTime()
    );
    expect(cImpact?.previousStartAt).toBe(c.startAt);

    // Preview must not have written anything — re-reading B before the real
    // PATCH still shows its original dates.
    const bBefore = await request<MilestoneDto[]>(`/workspaces/${workspaceId}/milestones`, { method: "GET", token: alice.accessToken });
    const bRowBefore = bBefore.data.find((m) => m.id === b.id);
    expect(bRowBefore?.startAt).toBe(b.startAt);
    expect(bRowBefore?.dueAt).toBe(b.dueAt);

    // Now actually apply A's move — the real PATCH performs its own
    // cascade (independent code path, same algorithm) and must land on
    // exactly the dates the preview promised, not shift twice.
    const applied = await request<MilestoneDto>(`/workspaces/${workspaceId}/milestones/${a.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { startAt: newAStart, dueAt: newADue }
    });
    expect(applied.status).toBe(200);

    const after = await request<MilestoneDto[]>(`/workspaces/${workspaceId}/milestones`, { method: "GET", token: alice.accessToken });
    const bAfter = after.data.find((m) => m.id === b.id);
    const cAfter = after.data.find((m) => m.id === c.id);
    expect(bAfter?.startAt).toBe(bImpact?.nextStartAt);
    expect(bAfter?.dueAt).toBe(bImpact?.nextDueAt);
    expect(cAfter?.startAt).toBe(cImpact?.nextStartAt);
    expect(cAfter?.dueAt).toBe(cImpact?.nextDueAt);
  });

  it("preview returns an empty array when the new dates don't push any dependent — no confirmation needed", async () => {
    const bob = await register("bob");
    const { workspaceId, a, day } = await makeProjectPlan(bob.accessToken, bob.workspaceId);

    // Shrink A's own window without moving its due date at all — B's start
    // requirement (A's dueAt) is unchanged, so nothing downstream should move.
    const preview = await request<CascadeImpact[]>(`/workspaces/${workspaceId}/milestones/${a.id}/reschedule-preview`, {
      method: "POST",
      token: bob.accessToken,
      body: { startAt: day(2), dueAt: a.dueAt }
    });
    expect(preview.status).toBe(201);
    expect(preview.data).toEqual([]);
  });

  it("a milestone with no dependents never appears in its own preview response", async () => {
    const carol = await register("carol");
    const { workspaceId, c, day } = await makeProjectPlan(carol.accessToken, carol.workspaceId);

    // C is the tail of the chain — nothing depends on C, so moving C can
    // never cascade to anything, and C itself must not appear as its own
    // "impact" (the preview only reports OTHER milestones).
    const preview = await request<CascadeImpact[]>(`/workspaces/${workspaceId}/milestones/${c.id}/reschedule-preview`, {
      method: "POST",
      token: carol.accessToken,
      body: { startAt: day(100), dueAt: day(105) }
    });
    expect(preview.status).toBe(201);
    expect(preview.data).toEqual([]);
  });

  it("preview is member-scoped like every other milestone route — a non-member gets 403, not another workspace's plan", async () => {
    const dave = await register("dave");
    const { workspaceId, a } = await makeProjectPlan(dave.accessToken, dave.workspaceId);
    const eve = await register("eve");

    const preview = await request<CascadeImpact[]>(`/workspaces/${workspaceId}/milestones/${a.id}/reschedule-preview`, {
      method: "POST",
      token: eve.accessToken,
      body: { startAt: a.startAt, dueAt: a.dueAt }
    });
    expect(preview.status).toBe(403);
  });
});
