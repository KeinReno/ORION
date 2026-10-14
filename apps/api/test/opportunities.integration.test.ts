import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Opportunity, OpportunityPage } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService } from "../src/sync/snapshot.service";

describe("Opportunities: real HTTP and PostgreSQL boundaries", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const prefix = `opportunity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"], abortOnError: false }); configureApp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (prisma) await prisma.asSystem(async (tx) => {
      await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await app?.close();
  });
  async function request<T>(path: string, token: string, method = "GET", body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() as T };
  }
  async function register(name: string) {
    const res = await request<{ accessToken: string; user: { id: string } }>("/auth/register", "", "POST", { email: `${prefix}-${name}@example.test`, password: "integration-password-123", name });
    expect(res.status).toBe(201); userIds.push(res.data.user.id);
    const workspaces = await request<{ id: string }[]>("/workspaces/me", res.data.accessToken);
    const workspaceId = workspaces.data[0].id; workspaceIds.push(workspaceId);
    return { token: res.data.accessToken, userId: res.data.user.id, workspaceId, path: `/workspaces/${workspaceId}/opportunities` };
  }

  it("creates both kinds, filters/pages, exports and retains archive/history", async () => {
    const a = await register("crud");
    const job = await request<Opportunity>(a.path, a.token, "POST", { kind: "job", title: "Аналитик", organizationName: "Компания", sourceType: "hh", externalId: "123" });
    expect(job.status).toBe(201); expect(job.data.conditions.amountMin).toBeNull();
    const contract = await request<Opportunity>(a.path, a.token, "POST", { kind: "contract", title: "Дизайн" });
    expect(contract.status).toBe(201);
    const page = await request<OpportunityPage>(`${a.path}?limit=1`, a.token);
    expect(page.data.items).toHaveLength(1); expect(page.data.nextCursor).toBeTruthy();
    const next = await request<OpportunityPage>(`${a.path}?limit=1&cursor=${page.data.nextCursor}`, a.token);
    expect(next.data.items).toHaveLength(1); expect(next.data.items[0].id).not.toBe(page.data.items[0].id);
    expect((await request<OpportunityPage>(`${a.path}?kind=contract&query=${encodeURIComponent("Дизайн")}`, a.token)).data.items[0].id).toBe(contract.data.id);
    expect((await request(a.path, a.token, "POST", { kind: "job", title: "Duplicate", sourceType: "hh", externalId: "123" })).status).toBe(409);
    const archived = await request<Opportunity>(`${a.path}/${job.data.id}`, a.token, "PATCH", { expectedRevision: 0, archivedAt: new Date().toISOString() });
    expect(archived.status).toBe(200); expect(archived.data.revision).toBe(1);
    expect((await request<OpportunityPage>(a.path, a.token)).data.items).toHaveLength(1);
    expect((await request<Opportunity[]>(`${a.path}/export`, a.token)).data).toHaveLength(2);
    const restored = await request<Opportunity>(`${a.path}/${job.data.id}`, a.token, "PATCH", { expectedRevision: 1, archivedAt: null });
    expect(restored.data.archivedAt).toBeNull(); expect(restored.data.history.map((h) => h.action)).toEqual(["created", "archived", "restored"]);
  });
  it("rejects lost updates atomically, including two simultaneous clients", async () => {
    const a = await register("concurrency");
    const row = (await request<Opportunity>(a.path, a.token, "POST", { kind: "job", title: "Original" })).data;
    const results = await Promise.all(["A", "B"].map((title) => request(`${a.path}/${row.id}`, a.token, "PATCH", { expectedRevision: 0, title })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await request<Opportunity>(`${a.path}/${row.id}`, a.token)).data.history).toHaveLength(2);
    expect((await request(`${a.path}/${row.id}`, a.token, "PATCH", { expectedRevision: 1 })).status).toBe(400);
  });
  it("enforces membership, raw RLS and disabled-module retention", async () => {
    const a = await register("owner"); const b = await register("outsider");
    const row = (await request<Opportunity>(a.path, a.token, "POST", { kind: "contract", title: "Private" })).data;
    expect((await request(`${a.path}/${row.id}`, b.token)).status).not.toBe(200);
    expect((await request(`${b.path}/${row.id}`, b.token)).status).toBe(404);
    const raw = await prisma.withUser(b.userId, (tx) => tx.opportunity.findMany({ where: { id: row.id } })); expect(raw).toEqual([]);
    const modules = `/workspaces/${a.workspaceId}/modules/opportunities`;
    expect((await request(modules, a.token, "PATCH", { enabled: false })).status).toBe(200);
    expect((await request(a.path, a.token)).status).toBe(409);
    expect((await request(a.path, a.token, "POST", { kind: "job", title: "Blocked" })).status).toBe(409);
    expect((await request(modules, a.token, "PATCH", { enabled: true })).status).toBe(200);
    expect((await request<Opportunity>(`${a.path}/${row.id}`, a.token)).data.title).toBe("Private");
  });
  it("blocks restricted members and limits whole-workspace export to the owner", async () => {
    const a = await register("restricted-owner"); const b = await register("member");
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: a.workspaceId, userId: b.userId, role: "member" } }));
    expect((await request(a.path, b.token)).status).toBe(200);
    expect((await request(`${a.path}/export`, b.token)).status).toBe(403);
    expect((await request(`/workspaces/${a.workspaceId}/modules/opportunities/restrict`, a.token, "PATCH", { restricted: true })).status).toBe(200);
    expect((await request(a.path, b.token)).status).toBe(403);
    expect((await request(a.path, a.token)).status).toBe(200);
  });
  it("restores actual opportunity data and history from a snapshot", async () => {
    const a = await register("backup");
    const row = (await request<Opportunity>(a.path, a.token, "POST", { kind: "job", title: "Before backup" })).data;
    const service = app.get(SnapshotService);
    const snapshot = await prisma.withUser(a.userId, (tx) => service.serialize(tx, a.workspaceId));
    expect(snapshot.tables.opportunities).toHaveLength(1);
    await request(`${a.path}/${row.id}`, a.token, "PATCH", { expectedRevision: 0, title: "After backup" });
    await prisma.withUser(a.userId, (tx) => service.apply(tx, snapshot));
    const restored = (await request<Opportunity>(`${a.path}/${row.id}`, a.token)).data;
    expect(restored.title).toBe("Before backup"); expect(restored.revision).toBe(0); expect(restored.history).toHaveLength(1);
  });
});
