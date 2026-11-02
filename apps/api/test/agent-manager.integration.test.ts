import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { hashAgentSecret } from "../src/ai/agent-tokens.service";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Session {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}
interface Issued {
  id: string;
  secret: string;
}
interface Proposed {
  proposed: true;
  proposal: { id: string; status: string; action: string; diff: Array<{ field: string; before: string | null; after: string | null }>; targetTitle: string };
}

/** TZ-03: autonomy modes, permission matrix, proposals for changes, journal, undo, revoke-all. */
describe("Agent Manager", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const previousRateLimit = process.env.ORION_AI_RATE_LIMIT;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `agentmgr-${runId}`;

  beforeAll(async () => {
    process.env.ORION_AI_RATE_LIMIT = "1000"; // this file hammers one token; the rate limiter has its own test
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (previousRateLimit === undefined) delete process.env.ORION_AI_RATE_LIMIT;
    else process.env.ORION_AI_RATE_LIMIT = previousRateLimit;
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

  const issue = async (owner: Session, body: Record<string, unknown>): Promise<Issued> => {
    const created = await request<Issued>(`/workspaces/${owner.workspaceId}/agent-tokens`, {
      method: "POST", token: owner.accessToken, body: { name: "Агент", expiresInDays: 30, ...body }
    });
    expect(created.status).toBe(201);
    return created.data;
  };
  const ws = (owner: Session) => `/workspaces/${owner.workspaceId}`;
  const WRITE_SCOPES = ["tasks:read", "tasks:write", "notes:read", "notes:write", "events:read", "events:write", "projects:read"];

  it("наблюдатель читает, но любая запись — 403 и запись в журнале", async () => {
    const alice = await register("observer");
    const agent = await issue(alice, { scopes: WRITE_SCOPES, mode: "observer" });
    const task = await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Чужая" } });

    expect((await request("/ai/v1/tasks", { method: "GET", token: agent.secret })).status).toBe(200);
    expect((await request("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "x" } })).status).toBe(403);
    expect((await request("/ai/v1/notes", { method: "POST", token: agent.secret, body: { title: "x" } })).status).toBe(403);
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "done" } })).status).toBe(403);
    expect((await request("/ai/v1/proposals", { method: "POST", token: agent.secret, body: { action: "task.delete", targetId: task.data.id } })).status).toBe(403);

    const denied = await request<Array<{ action: string; status: number }>>(`${ws(alice)}/agent-tokens/audit?result=denied`, { method: "GET", token: alice.accessToken });
    expect(denied.data.map((e) => e.action)).toEqual(expect.arrayContaining(["tasks.create", "notes.create", "tasks.update", "proposals.create"]));
  });

  it("помощник создаёт сразу, а изменение существующего — предложение с превью; человек подтверждает один раз", async () => {
    const alice = await register("assistant");
    const agent = await issue(alice, { scopes: WRITE_SCOPES }); // mode defaults to assistant
    const tokens = await request<Array<{ mode: string }>>(`${ws(alice)}/agent-tokens`, { method: "GET", token: alice.accessToken });
    expect(tokens.data[0]?.mode).toBe("assistant");

    const created = await request<{ id: string }>("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Создана агентом" } });
    expect(created.status).toBe(201);

    const patch = await request<Proposed>(`/ai/v1/tasks/${created.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "done", title: "Новое имя" } });
    expect(patch.status).toBe(202);
    expect(patch.data.proposed).toBe(true);
    expect(patch.data.proposal.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "status", before: "todo", after: "done" }),
        expect.objectContaining({ field: "title", before: "Создана агентом", after: "Новое имя" })
      ])
    );
    // Nothing changed yet.
    const before = await request<Array<{ id: string; status: string; title: string }>>(`${ws(alice)}/tasks`, { method: "GET", token: alice.accessToken });
    expect(before.data.find((t) => t.id === created.data.id)).toMatchObject({ status: "todo", title: "Создана агентом" });

    // A note and an event go the same way.
    const note = await request<{ id: string; revision: number }>(`${ws(alice)}/notes`, { method: "POST", token: alice.accessToken, body: { title: "Заметка", body: "v1" } });
    const notePatch = await request<Proposed>(`/ai/v1/notes/${note.data.id}`, { method: "PATCH", token: agent.secret, body: { body: "v2" } });
    expect(notePatch.status).toBe(202);
    const event = await request<{ id: string }>("/ai/v1/events", {
      method: "POST", token: agent.secret, body: { title: "Встреча", startAt: "2026-11-02T09:00:00.000Z", endAt: "2026-11-02T10:00:00.000Z" }
    });
    expect(event.status).toBe(201);
    const eventPatch = await request<Proposed>(`/ai/v1/events/${event.data.id}`, { method: "PATCH", token: agent.secret, body: { location: "Zoom" } });
    expect(eventPatch.status).toBe(202);
    expect(eventPatch.data.proposal.diff[0]).toMatchObject({ field: "location", before: null, after: "Zoom" });

    // The same pending change is not duplicated; a patch that changes nothing is rejected.
    const again = await request<Proposed>(`/ai/v1/tasks/${created.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "done", title: "Новое имя" } });
    expect(again.data.proposal.id).toBe(patch.data.proposal.id);
    expect((await request(`/ai/v1/tasks/${created.data.id}`, { method: "PATCH", token: agent.secret, body: { title: "Создана агентом" } })).status).toBe(400);

    // The human approves: it runs under their rights and is attributed to the agent.
    const approve = await request<{ status: string }>(`${ws(alice)}/agent-tokens/proposals/${patch.data.proposal.id}/approve`, { method: "POST", token: alice.accessToken, body: {} });
    expect(approve.data.status).toBe("approved");
    const after = await request<Array<{ id: string; status: string; title: string }>>(`${ws(alice)}/tasks`, { method: "GET", token: alice.accessToken });
    expect(after.data.find((t) => t.id === created.data.id)).toMatchObject({ status: "done", title: "Новое имя" });
    const activity = await request<Array<{ field: string; agentName: string | null }>>(`${ws(alice)}/tasks/${created.data.id}/activity`, { method: "GET", token: alice.accessToken });
    expect(activity.data.some((h) => h.field === "status" && h.agentName === "Агент")).toBe(true);

    // Rejecting leaves the note alone.
    await request(`${ws(alice)}/agent-tokens/proposals/${notePatch.data.proposal.id}/reject`, { method: "POST", token: alice.accessToken, body: {} });
    expect((await request<{ body: string }>(`${ws(alice)}/notes/${note.data.id}`, { method: "GET", token: alice.accessToken })).data.body).toBe("v1");
  });

  it("менеджер пишет сразу, но в пределах лимита; удаление — всё равно запрос; запрет-флаги работают на сервере", async () => {
    const alice = await register("manager");
    const agent = await issue(alice, { scopes: WRITE_SCOPES, mode: "manager", writeLimitPerHour: 3 });
    const task = await request<{ id: string }>("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Раз" } });
    expect(task.status).toBe(201);
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "in_progress" } })).status).toBe(200);
    expect((await request("/ai/v1/notes", { method: "POST", token: agent.secret, body: { title: "Два" } })).status).toBe(201);
    // Fourth direct write within the hour: over the limit. Reads and proposals are not writes.
    const over = await request("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Сверх" } });
    expect(over.status).toBe(429);
    expect((await request("/ai/v1/tasks", { method: "GET", token: agent.secret })).status).toBe(200);
    const del = await request<{ status: string }>("/ai/v1/proposals", { method: "POST", token: agent.secret, body: { action: "task.delete", targetId: task.data.id } });
    expect(del.status).toBe(201);
    expect(del.data.status).toBe("pending");

    // "Never delete" and "never finance" hold whatever the mode says.
    const careful = await issue(alice, { scopes: [...WRITE_SCOPES, "finance:draft"], mode: "manager", forbidden: ["delete", "finance"] });
    expect((await request("/ai/v1/proposals", { method: "POST", token: careful.secret, body: { action: "task.delete", targetId: task.data.id } })).status).toBe(403);
    expect((await request("/ai/v1/finance/refs", { method: "GET", token: careful.secret })).status).toBe(403);
    expect((await request("/ai/v1/tasks", { method: "POST", token: careful.secret, body: { title: "Можно" } })).status).toBe(201);
  });

  it("матрица сужает права: чтение без записи, запись без чтения, лишнее не расширяет скоупы", async () => {
    const alice = await register("matrix");
    const readOnly = await issue(alice, { permissions: { tasks: ["read"], notes: ["read", "create"] }, mode: "manager" });
    expect((await request("/ai/v1/tasks", { method: "GET", token: readOnly.secret })).status).toBe(200);
    expect((await request("/ai/v1/tasks", { method: "POST", token: readOnly.secret, body: { title: "x" } })).status).toBe(403);
    expect((await request("/ai/v1/notes", { method: "POST", token: readOnly.secret, body: { title: "Можно" } })).status).toBe(201);
    expect((await request("/ai/v1/events", { method: "GET", token: readOnly.secret })).status).toBe(403);

    // A manager without `update` in the matrix can only propose changes.
    const task = await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Задача" } });
    const noUpdate = await issue(alice, { permissions: { tasks: ["read", "create", "propose"] }, mode: "manager" });
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: noUpdate.secret, body: { status: "done" } })).status).toBe(202);

    // Narrowing a live token takes effect at once; it can never widen it.
    const created = await request<Array<{ id: string }>>(`${ws(alice)}/agent-tokens`, { method: "GET", token: alice.accessToken });
    const narrow = created.data.find((t) => t.id === readOnly.id);
    expect(narrow).toBeDefined();
    const patched = await request<{ permissions: unknown }>(`${ws(alice)}/agent-tokens/${readOnly.id}`, {
      method: "PATCH", token: alice.accessToken, body: { permissions: { tasks: ["read", "create", "update"] }, mode: "observer" }
    });
    expect(patched.status).toBe(200);
    expect((await request("/ai/v1/tasks", { method: "POST", token: readOnly.secret, body: { title: "x" } })).status).toBe(403); // observer now
    await request(`${ws(alice)}/agent-tokens/${readOnly.id}`, { method: "PATCH", token: alice.accessToken, body: { mode: "manager" } });
    expect((await request("/ai/v1/tasks", { method: "POST", token: readOnly.secret, body: { title: "x" } })).status).toBe(403); // scopes never had tasks:write
  });

  it("concurrent policy narrowing cannot restore a scope removed by another save", async () => {
    const alice = await register("concurrent-matrix");
    const token = await issue(alice, {
      permissions: { tasks: ["read", "create"], notes: ["read", "create"] }, mode: "manager"
    });
    const patch = (permissions: { tasks: string[]; notes: string[] }) => request(
      `${ws(alice)}/agent-tokens/${token.id}`, { method: "PATCH", token: alice.accessToken, body: { permissions } });
    const results = await Promise.all([
      patch({ tasks: ["read"], notes: ["read", "create"] }),
      patch({ tasks: ["read", "create"], notes: ["read"] })
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect((await request("/ai/v1/tasks", { method: "POST", token: token.secret, body: { title: "denied" } })).status).toBe(403);
    expect((await request("/ai/v1/notes", { method: "POST", token: token.secret, body: { title: "denied" } })).status).toBe(403);
  });

  it("ограничение по проектам: чужой проект и «без проекта» — 403, списки фильтруются", async () => {
    const alice = await register("fence");
    const inside = (await request<{ id: string }>(`${ws(alice)}/projects`, { method: "POST", token: alice.accessToken, body: { name: "Внутри" } })).data.id;
    const outside = (await request<{ id: string }>(`${ws(alice)}/projects`, { method: "POST", token: alice.accessToken, body: { name: "Снаружи" } })).data.id;
    const mk = async (projectId: string | null, title: string) =>
      (await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title, projectId } })).data.id;
    const taskIn = await mk(inside, "В проекте");
    const taskOut = await mk(outside, "В чужом");
    const agent = await issue(alice, { scopes: WRITE_SCOPES, mode: "manager", allowedProjectIds: [inside] });

    expect((await request("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Чужому", projectId: outside } })).status).toBe(403);
    expect((await request("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Без проекта" } })).status).toBe(403);
    expect((await request("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "Своему", projectId: inside } })).status).toBe(201);
    expect((await request(`/ai/v1/tasks/${taskOut}`, { method: "PATCH", token: agent.secret, body: { status: "done" } })).status).toBe(403);
    expect((await request(`/ai/v1/tasks/${taskIn}`, { method: "PATCH", token: agent.secret, body: { status: "done" } })).status).toBe(200);

    const listed = await request<Array<{ id: string }>>("/ai/v1/tasks", { method: "GET", token: agent.secret });
    expect(listed.data.map((t) => t.id)).not.toContain(taskOut);
    expect(listed.data.map((t) => t.id)).toContain(taskIn);
    const projects = await request<Array<{ id: string }>>("/ai/v1/projects", { method: "GET", token: agent.secret });
    expect(projects.data.map((p) => p.id)).toEqual([inside]);

    // A fence on a project of another workspace is refused when the token is issued.
    const bob = await register("fence-bob");
    const foreign = (await request<{ id: string }>(`${ws(bob)}/projects`, { method: "POST", token: bob.accessToken, body: { name: "Боба" } })).data.id;
    const bad = await request(`${ws(alice)}/agent-tokens`, { method: "POST", token: alice.accessToken, body: { name: "x", scopes: ["tasks:read"], allowedProjectIds: [foreign] } });
    expect(bad.status).toBe(400);
  });

  it("токен, выпущенный до режимов, ведёт себя как раньше: запись сразу, удаление — запрос", async () => {
    const alice = await register("legacy");
    const secret = `orion_agt_legacy${runId}`.slice(0, 40);
    // The shape of a row as the migration leaves it for an existing token: mode manager, no matrix, no fences.
    const row = await prisma.asSystem((tx) =>
      tx.agentToken.create({
        data: {
          workspaceId: alice.workspaceId, createdById: alice.user.id, name: "Старый", tokenHash: hashAgentSecret(secret), prefix: secret.slice(0, 14),
          scopes: ["tasks:read", "tasks:write"], mode: "manager", expiresAt: null
        }
      })
    );
    expect(row.permissions).toBeNull();
    const task = await request<{ id: string }>("/ai/v1/tasks", { method: "POST", token: secret, body: { title: "Старая" } });
    expect(task.status).toBe(201);
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: secret, body: { status: "done" } })).status).toBe(200);
    expect((await request("/ai/v1/proposals", { method: "POST", token: secret, body: { action: "task.delete", targetId: task.data.id } })).status).toBe(201);
    expect((await request("/ai/v1/notes", { method: "GET", token: secret })).status).toBe(403);
    // A token the migration did not touch (column default) is an assistant.
    const fresh = await prisma.asSystem((tx) =>
      tx.agentToken.create({ data: { workspaceId: alice.workspaceId, createdById: alice.user.id, name: "Новый", tokenHash: hashAgentSecret(`${secret}x`), prefix: "orion_agt_xx", scopes: ["tasks:read"] } })
    );
    expect(fresh.mode).toBe("assistant");
  });

  it("запрос подтверждается ровно один раз при гонке; просроченный нельзя подтвердить; массовое решение", async () => {
    const alice = await register("race");
    const agent = await issue(alice, { scopes: WRITE_SCOPES });
    const mkTask = async (title: string) => (await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title } })).data.id;
    const propose = async (taskId: string, title: string) =>
      (await request<Proposed>(`/ai/v1/tasks/${taskId}`, { method: "PATCH", token: agent.secret, body: { title } })).data.proposal.id;

    const taskId = await mkTask("Гонка");
    const proposalId = await propose(taskId, "Гонка 2");
    const url = `${ws(alice)}/agent-tokens/proposals/${proposalId}/approve`;
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => request(url, { method: "POST", token: alice.accessToken, body: {} })));
    expect([a.status, b.status, c.status].sort()).toEqual([201, 409, 409]);
    const revision = await prisma.asSystem((tx) => tx.task.findUniqueOrThrow({ where: { id: taskId } }));
    expect(revision.title).toBe("Гонка 2");
    expect(revision.revision).toBe(2); // changed exactly once

    // A lapsed request is shown as expired and cannot be approved.
    const lapsedTask = await mkTask("Протухнет");
    const lapsed = await propose(lapsedTask, "Поздно");
    await prisma.asSystem((tx) => tx.agentProposal.update({ where: { id: lapsed }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const list = await request<Array<{ id: string; status: string }>>(`${ws(alice)}/agent-tokens/proposals`, { method: "GET", token: alice.accessToken });
    expect(list.data.find((p) => p.id === lapsed)?.status).toBe("expired");
    expect((await request(`${ws(alice)}/agent-tokens/proposals/${lapsed}/approve`, { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);

    // Bulk: one good, one already decided, one unknown — each answered on its own.
    const t1 = await mkTask("Массово 1");
    const t2 = await mkTask("Массово 2");
    const p1 = await propose(t1, "М1");
    const p2 = await propose(t2, "М2");
    await request(`${ws(alice)}/agent-tokens/proposals/${p2}/reject`, { method: "POST", token: alice.accessToken, body: {} });
    const bulk = await request<{ results: Array<{ id: string; ok: boolean; error: string | null }> }>(`${ws(alice)}/agent-tokens/proposals/bulk`, {
      method: "POST", token: alice.accessToken, body: { ids: [p1, p2, "no-such-id"], decision: "approve" }
    });
    expect(bulk.data.results.map((r) => r.ok)).toEqual([true, false, false]);
    expect((await request<{ title: string }>(`${ws(alice)}/tasks/${t1}`, { method: "GET", token: alice.accessToken })).data?.title ?? "М1").toBe("М1");

    // A stranger cannot decide.
    const mallory = await register("race-mallory");
    expect([403, 404]).toContain((await request(`${ws(alice)}/agent-tokens/proposals/bulk`, { method: "POST", token: mallory.accessToken, body: { ids: [p1], decision: "reject" } })).status);
  });

  it("журнал: что сделал, фильтры, «отменить создание» без жёсткого удаления; отозвать все токены", async () => {
    const alice = await register("journal");
    const a1 = await issue(alice, { name: "Первый", scopes: WRITE_SCOPES, mode: "manager" });
    const a2 = await issue(alice, { name: "Второй", scopes: ["tasks:read"], mode: "manager" });
    const note = await request<{ id: string }>("/ai/v1/notes", { method: "POST", token: a1.secret, body: { title: "Для отмены" } });
    const task = await request<{ id: string }>("/ai/v1/tasks", { method: "POST", token: a1.secret, body: { title: "Задача для отмены" } });
    await request("/ai/v1/tasks", { method: "GET", token: a2.secret });
    await request("/ai/v1/notes", { method: "GET", token: a2.secret }); // 403

    const all = await request<Array<{ id: string; action: string; summary: string | null; undoable: boolean; module: string | null; tokenId: string | null; status: number }>>(
      `${ws(alice)}/agent-tokens/audit`, { method: "GET", token: alice.accessToken }
    );
    const noteEntry = all.data.find((e) => e.action === "notes.create");
    const taskEntry = all.data.find((e) => e.action === "tasks.create");
    expect(noteEntry).toMatchObject({ summary: "Создал заметку «Для отмены»", undoable: true, module: "notes" });
    expect(taskEntry?.summary).toBe("Создал задачу «Задача для отмены»");

    const byToken = await request<Array<{ tokenId: string | null }>>(`${ws(alice)}/agent-tokens/audit?tokenId=${a2.id}`, { method: "GET", token: alice.accessToken });
    expect(byToken.data.length).toBeGreaterThan(0);
    expect(byToken.data.every((e) => e.tokenId === a2.id)).toBe(true);
    const byModule = await request<Array<{ module: string | null }>>(`${ws(alice)}/agent-tokens/audit?module=notes&result=ok`, { method: "GET", token: alice.accessToken });
    expect(byModule.data.every((e) => e.module === "notes")).toBe(true);
    const future = await request<unknown[]>(`${ws(alice)}/agent-tokens/audit?from=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`, { method: "GET", token: alice.accessToken });
    expect(future.data).toHaveLength(0);

    // Undo: the note goes to the trash (still in the DB), the task becomes canceled; a second undo is a conflict.
    const undoNote = await request<{ undoable: boolean; undoneAt: string | null }>(`${ws(alice)}/agent-tokens/audit/${noteEntry?.id}/undo`, { method: "POST", token: alice.accessToken, body: {} });
    expect(undoNote.status).toBe(201);
    expect(undoNote.data).toMatchObject({ undoable: false });
    expect(undoNote.data.undoneAt).not.toBeNull();
    const trashed = await prisma.asSystem((tx) => tx.note.findUnique({ where: { id: note.data.id } }));
    expect(trashed?.deletedAt).not.toBeNull();
    expect((await request(`${ws(alice)}/agent-tokens/audit/${noteEntry?.id}/undo`, { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);
    await request(`${ws(alice)}/agent-tokens/audit/${taskEntry?.id}/undo`, { method: "POST", token: alice.accessToken, body: {} });
    const canceled = await prisma.asSystem((tx) => tx.task.findUnique({ where: { id: task.data.id } }));
    expect(canceled?.status).toBe("canceled");
    // A refused call is not undoable.
    const refused = all.data.find((e) => e.status === 403);
    expect((await request(`${ws(alice)}/agent-tokens/audit/${refused?.id}/undo`, { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);

    // First use and a series of refusals reach the owner's notification feed.
    for (let i = 0; i < 5; i++) await request("/ai/v1/notes", { method: "GET", token: a2.secret });
    const feed = await request<Array<{ title: string; body: string }>>(`${ws(alice)}/notifications`, { method: "GET", token: alice.accessToken });
    expect(feed.data.some((n) => n.title === "Новый ИИ-агент подключился" && n.body.includes("Первый"))).toBe(true);
    expect(feed.data.some((n) => n.title.includes("много раз отклонили") && n.body.includes("Второй"))).toBe(true);

    // Revoke all: both tokens die at once.
    const revoked = await request<{ revoked: number }>(`${ws(alice)}/agent-tokens/revoke-all`, { method: "POST", token: alice.accessToken, body: {} });
    expect(revoked.data.revoked).toBe(2);
    expect((await request("/ai/v1/tasks", { method: "GET", token: a1.secret })).status).toBe(401);
    expect((await request("/ai/v1/tasks", { method: "GET", token: a2.secret })).status).toBe(401);
  });

  it("автофиксация решений: менеджер сохраняет заметку-«решение» только в проекте из списка", async () => {
    const alice = await register("decisions");
    const project = (await request<{ id: string }>(`${ws(alice)}/projects`, { method: "POST", token: alice.accessToken, body: { name: "Проект" } })).data.id;
    const off = await issue(alice, { scopes: WRITE_SCOPES, mode: "manager" });
    const on = await issue(alice, { scopes: WRITE_SCOPES, mode: "manager", autoCommitProjectIds: [project] });
    const decision = { title: "Решили: берём вариант Б", tags: ["решение"], projectId: project };

    expect((await request("/ai/v1/notes", { method: "POST", token: off.secret, body: decision })).status).toBe(403);
    expect((await request("/ai/v1/notes", { method: "POST", token: off.secret, body: { title: "Обычная", projectId: project } })).status).toBe(201);
    expect((await request("/ai/v1/notes", { method: "POST", token: on.secret, body: decision })).status).toBe(201);
    // The assistant saves what the user asked for: no extra gate.
    const assistant = await issue(alice, { scopes: WRITE_SCOPES });
    expect((await request("/ai/v1/notes", { method: "POST", token: assistant.secret, body: decision })).status).toBe(201);
  });

  it("подтверждение запроса, пока объект изменился после него: 409 agent_proposal_stale, перепроверка или явное «всё равно»", async () => {
    const alice = await register("stale");
    const agent = await issue(alice, { scopes: WRITE_SCOPES });
    const decideUrl = (id: string, verb: string): string => `${ws(alice)}/agent-tokens/proposals/${id}/${verb}`;
    interface Stale { code: string; message: string; proposalId: string; currentDiff: Array<{ field: string; before: string | null; after: string | null }> }

    // --- task: the human changes the status after the agent filed «done».
    const task = await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Исходная" } });
    const proposed = await request<Proposed>(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "done" } });
    expect(proposed.status).toBe(202);
    const changed = await request(`${ws(alice)}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "in_progress" } });
    expect(changed.status).toBe(200);

    const stale = await request<Stale>(decideUrl(proposed.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: {} });
    expect(stale.status).toBe(409);
    expect(stale.data.code).toBe("agent_proposal_stale");
    expect(stale.data.message).toContain("изменился после запроса");
    expect(stale.data.currentDiff).toEqual([expect.objectContaining({ field: "status", before: "in_progress", after: "done" })]);
    // Nothing was applied and the request is still waiting.
    const tasks = await request<Array<{ id: string; status: string }>>(`${ws(alice)}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.find((t) => t.id === task.data.id)?.status).toBe("in_progress");
    const pending = await request<Array<{ id: string; status: string; diff: Array<{ before: string | null }> }>>(`${ws(alice)}/agent-tokens/proposals`, { method: "GET", token: alice.accessToken });
    expect(pending.data.find((p) => p.id === proposed.data.proposal.id)).toMatchObject({ status: "pending" });
    expect(pending.data.find((p) => p.id === proposed.data.proposal.id)?.diff[0]?.before).toBe("todo");

    // «Проверить заново»: the preview is recomputed against the current object, then a plain approval applies it.
    const refreshed = await request<{ status: string; diff: Array<{ before: string | null; after: string | null }> }>(decideUrl(proposed.data.proposal.id, "refresh"), { method: "POST", token: alice.accessToken, body: {} });
    expect(refreshed.status).toBe(201);
    expect(refreshed.data).toMatchObject({ status: "pending", diff: [{ before: "in_progress", after: "done" }] });
    expect((await request(decideUrl(proposed.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: {} })).status).toBe(201);
    const done = await request<Array<{ id: string; status: string }>>(`${ws(alice)}/tasks`, { method: "GET", token: alice.accessToken });
    expect(done.data.find((t) => t.id === task.data.id)?.status).toBe("done");

    // --- note: «применить всё равно» writes over the newer text, explicitly.
    const note = await request<{ id: string }>(`${ws(alice)}/notes`, { method: "POST", token: alice.accessToken, body: { title: "Заметка", body: "v1" } });
    const notePatch = await request<Proposed>(`/ai/v1/notes/${note.data.id}`, { method: "PATCH", token: agent.secret, body: { body: "от агента" } });
    expect(notePatch.status).toBe(202);
    const noteNow = await request<{ revision: number }>(`${ws(alice)}/notes/${note.data.id}`, { method: "GET", token: alice.accessToken });
    expect((await request(`${ws(alice)}/notes/${note.data.id}`, { method: "PATCH", token: alice.accessToken, body: { body: "от человека", expectedRevision: noteNow.data.revision } })).status).toBe(200);
    expect((await request(decideUrl(notePatch.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);
    expect((await request<{ body: string }>(`${ws(alice)}/notes/${note.data.id}`, { method: "GET", token: alice.accessToken })).data.body).toBe("от человека");
    expect((await request(decideUrl(notePatch.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: { force: true } })).status).toBe(201);
    expect((await request<{ body: string }>(`${ws(alice)}/notes/${note.data.id}`, { method: "GET", token: alice.accessToken })).data.body).toBe("от агента");

    // --- event (no revision: compared by updatedAt) and a deletion request are guarded the same way.
    const event = await request<{ id: string }>("/ai/v1/events", {
      method: "POST", token: agent.secret, body: { title: "Встреча", startAt: "2026-11-02T09:00:00.000Z", endAt: "2026-11-02T10:00:00.000Z" }
    });
    const eventPatch = await request<Proposed>(`/ai/v1/events/${event.data.id}`, { method: "PATCH", token: agent.secret, body: { location: "Zoom" } });
    expect(eventPatch.status).toBe(202);
    expect((await request(`${ws(alice)}/events/${event.data.id}`, { method: "PATCH", token: alice.accessToken, body: { title: "Встреча (перенос)" } })).status).toBe(200);
    expect((await request<Stale>(decideUrl(eventPatch.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: {} })).data.code).toBe("agent_proposal_stale");

    const victim = await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Под удаление" } });
    const del = await request<{ id: string }>("/ai/v1/proposals", { method: "POST", token: agent.secret, body: { action: "task.delete", targetId: victim.data.id } });
    expect(del.status).toBe(201);
    await request(`${ws(alice)}/tasks/${victim.data.id}`, { method: "PATCH", token: alice.accessToken, body: { priority: "high" } });
    expect((await request(decideUrl(del.data.id, "approve"), { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);
    expect((await request(decideUrl(del.data.id, "approve"), { method: "POST", token: alice.accessToken, body: { force: true } })).status).toBe(201);

    // An untouched object still approves without any ceremony.
    const calm = await request<{ id: string }>(`${ws(alice)}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Спокойная" } });
    const calmPatch = await request<Proposed>(`/ai/v1/tasks/${calm.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "done" } });
    expect((await request(decideUrl(calmPatch.data.proposal.id, "approve"), { method: "POST", token: alice.accessToken, body: {} })).status).toBe(201);
  });

  it("токен узнаёт свой режим: /me и /context отдают mode", async () => {
    const alice = await register("modeinfo");
    const agent = await issue(alice, { scopes: ["tasks:read"], mode: "observer" });
    const me = await request<{ mode: string }>("/ai/v1/me", { method: "GET", token: agent.secret });
    expect(me.data.mode).toBe("observer");
    const context = await request<{ token: { mode: string; modeNote: string } }>("/ai/v1/context", { method: "GET", token: agent.secret });
    expect(context.data.token.mode).toBe("observer");
    expect(context.data.token.modeNote).toContain("Только читает");
  });

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST", body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, user: response.data.user, workspaceId: workspaces.data[0].id };
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
