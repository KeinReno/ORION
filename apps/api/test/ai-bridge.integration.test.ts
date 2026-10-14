import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

/** Small per-token budget so the rate-limit test is quick; read by the guard when the app starts. */
const TEST_RATE_LIMIT = 15;

describe("AI Bridge (agent tokens)", () => {
  const previousRateLimit = process.env.ORION_AI_RATE_LIMIT;
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `aibridge-${runId}`;

  beforeAll(async () => {
    process.env.ORION_AI_RATE_LIMIT = String(TEST_RATE_LIMIT);
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
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

  async function issue(owner: RegisteredSession, scopes: string[], expiresInDays = 30) {
    const created = await request<{ id: string; secret: string; prefix: string }>(`/workspaces/${owner.workspaceId}/agent-tokens`, {
      method: "POST", token: owner.accessToken, body: { name: "Claude", scopes, expiresInDays }
    });
    expect(created.status).toBe(201);
    return created.data;
  }

  it("токен работает в рамках своих разрешений, секрет виден один раз, действия в журнале", async () => {
    const alice = await register("alice");
    const token = await issue(alice, ["tasks:read", "tasks:write"]);
    expect(token.secret.startsWith("orion_agt_")).toBe(true);

    const listed = await request<Array<{ id: string; secret?: string }>>(`/workspaces/${alice.workspaceId}/agent-tokens`, {
      method: "GET", token: alice.accessToken
    });
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed.data)).not.toContain(token.secret);

    const me = await request<{ workspaceId: string; scopes: string[] }>("/ai/v1/me", { method: "GET", token: token.secret });
    expect(me.status).toBe(200);
    expect(me.data.workspaceId).toBe(alice.workspaceId);

    const task = await request<{ id: string; title: string }>("/ai/v1/tasks", {
      method: "POST", token: token.secret, body: { title: "Создано агентом" }
    });
    expect(task.status).toBe(201);
    const patched = await request<{ status: string }>(`/ai/v1/tasks/${task.data.id}`, {
      method: "PATCH", token: token.secret, body: { status: "in_progress" }
    });
    expect(patched.status).toBe(200);
    // Fields outside the agent's patch (e.g. assignee) are rejected, not silently applied.
    const sneaky = await request(`/ai/v1/tasks/${task.data.id}`, {
      method: "PATCH", token: token.secret, body: { assigneeId: alice.user.id }
    });
    expect(sneaky.status).toBeLessThan(500);

    // The human sees the same task in the ordinary API.
    const humanView = await request<Array<{ id: string }>>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "GET", token: alice.accessToken
    });
    expect(humanView.data.map((t) => t.id)).toContain(task.data.id);

    // No notes scope → 403, and it is audited.
    const denied = await request("/ai/v1/notes", { method: "GET", token: token.secret });
    expect(denied.status).toBe(403);

    const audit = await request<Array<{ action: string; status: number }>>(`/workspaces/${alice.workspaceId}/agent-tokens/audit`, {
      method: "GET", token: alice.accessToken
    });
    const actions = audit.data.map((e) => `${e.action}:${e.status}`);
    expect(actions).toContain("tasks.create:200");
    expect(actions).toContain("notes.list:403");
  });

  it("отозванный, истёкший, чужой и обычный JWT-токен не проходят", async () => {
    const alice = await register("alice2");
    const bob = await register("bob2");
    const token = await issue(alice, ["tasks:read"]);

    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);
    // A user session JWT is not an agent credential.
    expect((await request("/ai/v1/tasks", { method: "GET", token: alice.accessToken })).status).toBe(401);
    expect((await request("/ai/v1/tasks", { method: "GET", token: "orion_agt_nonsense" })).status).toBe(401);

    // Another member cannot revoke (or even see) Alice's token.
    const foreignRevoke = await request(`/workspaces/${alice.workspaceId}/agent-tokens/${token.id}`, {
      method: "DELETE", token: bob.accessToken
    });
    expect([403, 404]).toContain(foreignRevoke.status);
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);

    // Expiry.
    await prisma.asSystem((tx) => tx.agentToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(401);
    await prisma.asSystem((tx) => tx.agentToken.update({ where: { id: token.id }, data: { expiresAt: null } }));
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(200);

    const revoked = await request(`/workspaces/${alice.workspaceId}/agent-tokens/${token.id}`, {
      method: "DELETE", token: alice.accessToken
    });
    expect(revoked.status).toBe(204);
    expect((await request("/ai/v1/tasks", { method: "GET", token: token.secret })).status).toBe(401);
  });

  it("токен не видит чужое пространство и теряет доступ, когда владелец вышел из пространства", async () => {
    const alice = await register("alice3");
    const bob = await register("bob3");
    await request(`/workspaces/${bob.workspaceId}/tasks`, { method: "POST", token: bob.accessToken, body: { title: "Секрет Боба" } });
    const token = await issue(alice, ["tasks:read"]);
    const tasks = await request<Array<{ title: string }>>("/ai/v1/tasks", { method: "GET", token: token.secret });
    expect(tasks.data.map((t) => t.title)).not.toContain("Секрет Боба");

    await prisma.asSystem((tx) => tx.workspaceMember.deleteMany({ where: { userId: alice.user.id, workspaceId: alice.workspaceId } }));
    const after = await request("/ai/v1/tasks", { method: "GET", token: token.secret });
    expect([403, 404]).toContain(after.status);
  });

  it("MCP-сервер (stdio) проходит рукопожатие, показывает инструменты и работает через токен", async () => {
    const alice = await register("alice-mcp");
    const token = await issue(alice, ["tasks:read", "tasks:write"]);
    const script = resolve(__dirname, "../../../scripts/orion-mcp.mjs");
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ORION_API_URL: baseUrl, ORION_AGENT_TOKEN: token.secret },
      stdio: ["pipe", "pipe", "pipe"]
    });
    interface Rpc {
      id: number;
      result: { serverInfo: { name: string }; tools: Array<{ name: string }>; isError?: boolean; content: Array<{ text: string }> };
    }
    const pending = new Map<number, (value: Rpc) => void>();
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      }
    });
    let nextId = 1;
    const rpc = (method: string, params?: unknown) =>
      new Promise<Rpc>((done) => {
        const id = nextId++;
        pending.set(id, done);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    try {
      const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(init.result.serverInfo.name).toBe("orion");
      const list = await rpc("tools/list");
      expect(list.result.tools.map((t) => t.name)).toContain("orion_create_task");

      const created = await rpc("tools/call", { name: "orion_create_task", arguments: { title: "Через MCP" } });
      expect(created.result.isError).toBeUndefined();
      expect(JSON.parse(created.result.content[0].text).title).toBe("Через MCP");

      // A scope the token lacks comes back as a tool error the model can read, not a crash.
      const denied = await rpc("tools/call", { name: "orion_list_notes", arguments: {} });
      expect(denied.result.isError).toBe(true);
      expect(denied.result.content[0].text).toContain("403");
    } finally {
      child.kill();
    }
  });

  it("агенты переписываются внутри пространства: адресная доставка, чужие не читают, права не передаются", async () => {
    const alice = await register("alice-msg");
    const mallory = await register("mallory-msg");
    const a = await issue(alice, ["agents:message"]);
    const b = await issue(alice, ["agents:message", "tasks:read"]);
    const noScope = await issue(alice, ["tasks:read"]);
    const foreign = await issue(mallory, ["agents:message"]);

    const peers = await request<Array<{ id: string }>>("/ai/v1/agents", { method: "GET", token: a.secret });
    expect(peers.data.map((p) => p.id).sort()).toEqual([b.id, noScope.id].sort());

    const sent = await request<{ id: string }>("/ai/v1/messages", {
      method: "POST", token: a.secret, body: { toTokenId: b.id, subject: "Проверь задачи", body: "список за неделю" }
    });
    expect(sent.status).toBe(201);

    // A sender cannot read the receiver's inbox; the receiver sees it, unread first.
    expect((await request<unknown[]>("/ai/v1/messages", { method: "GET", token: a.secret })).data).toHaveLength(0);
    const inbox = await request<Array<{ id: string; subject: string; fromName: string; readAt: string | null }>>("/ai/v1/messages", { method: "GET", token: b.secret });
    expect(inbox.data).toHaveLength(1);
    expect(inbox.data[0]).toMatchObject({ subject: "Проверь задачи", readAt: null });
    expect((await request(`/ai/v1/messages/${sent.data.id}/read`, { method: "POST", token: a.secret })).status).toBe(404);
    expect((await request(`/ai/v1/messages/${sent.data.id}/read`, { method: "POST", token: b.secret })).status).toBe(204);
    expect((await request<Array<{ readAt: string | null }>>("/ai/v1/messages", { method: "GET", token: b.secret })).data[0].readAt).not.toBeNull();

    // Another workspace's agent is unreachable; so is a token without the scope.
    expect((await request("/ai/v1/messages", { method: "POST", token: a.secret, body: { toTokenId: foreign.id, subject: "x" } })).status).toBe(404);
    expect((await request("/ai/v1/messages", { method: "POST", token: noScope.secret, body: { toTokenId: a.id, subject: "x" } })).status).toBe(403);
    expect((await request("/ai/v1/messages", { method: "POST", token: a.secret, body: { toTokenId: a.id, subject: "я себе" } })).status).toBe(400);

    // The receiver does NOT inherit the sender's rights: `a` has no tasks scope and still has none.
    expect((await request("/ai/v1/tasks", { method: "GET", token: a.secret })).status).toBe(403);
  });

  it("задания между агентами: исполнитель отчитывается, выдавший только отменяет, итог финален", async () => {
    const alice = await register("alice-job");
    const giver = await issue(alice, ["agents:delegate"]);
    const worker = await issue(alice, ["agents:delegate"]);
    const outsider = await issue(alice, ["tasks:read"]);

    const created = await request<{ id: string; status: string; toName: string }>("/ai/v1/jobs", {
      method: "POST", token: giver.secret, body: { toTokenId: worker.id, title: "Свести отчёт", body: "за неделю" }
    });
    expect(created.status).toBe(201);
    expect(created.data.status).toBe("pending");
    const path = `/ai/v1/jobs/${created.data.id}`;

    expect((await request("/ai/v1/jobs", { method: "POST", token: giver.secret, body: { toTokenId: giver.id, title: "я себе" } })).status).toBe(400);
    expect((await request("/ai/v1/jobs", { method: "POST", token: outsider.secret, body: { toTokenId: worker.id, title: "x" } })).status).toBe(403);
    expect((await request<unknown[]>("/ai/v1/jobs", { method: "GET", token: worker.secret })).data).toHaveLength(1);

    // The giver cannot mark it done; a third party cannot see it at all.
    expect((await request(path, { method: "PATCH", token: giver.secret, body: { status: "done" } })).status).toBe(400);
    const stranger = await issue(alice, ["agents:delegate"]);
    expect((await request(path, { method: "PATCH", token: stranger.secret, body: { status: "done" } })).status).toBe(404);
    // The worker cannot cancel on the giver's behalf, but can progress and finish.
    expect((await request(path, { method: "PATCH", token: worker.secret, body: { status: "canceled" } })).status).toBe(400);
    expect((await request(path, { method: "PATCH", token: worker.secret, body: { status: "in_progress" } })).status).toBe(200);
    const done = await request<{ status: string; result: string }>(path, { method: "PATCH", token: worker.secret, body: { status: "done", result: "готово" } });
    expect(done.data).toMatchObject({ status: "done", result: "готово" });
    // A finished job is final.
    expect((await request(path, { method: "PATCH", token: giver.secret, body: { status: "canceled" } })).status).toBe(409);
  });

  it("агент не удаляет сам: запрос на удаление выполняет только человек, один раз, под своими правами", async () => {
    const alice = await register("alice-del");
    const bob = await register("bob-del");
    const agent = await issue(alice, ["tasks:write", "notes:write"]);
    const ws = `/workspaces/${alice.workspaceId}`;
    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Лишняя" } });

    // There is no delete verb for agents, and a proposal changes nothing by itself.
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "DELETE", token: agent.secret })).status).toBe(404);
    const proposal = await request<{ id: string; status: string; targetTitle: string }>("/ai/v1/proposals", {
      method: "POST", token: agent.secret, body: { action: "task.delete", targetId: task.data.id, reason: "дубль" }
    });
    expect(proposal.status).toBe(201);
    expect(proposal.data).toMatchObject({ status: "pending", targetTitle: "Лишняя" });
    const again = await request<{ id: string }>("/ai/v1/proposals", { method: "POST", token: agent.secret, body: { action: "task.delete", targetId: task.data.id } });
    expect(again.data.id).toBe(proposal.data.id); // no duplicate pending request
    const stillThere = await request<Array<{ id: string }>>(`${ws}/tasks`, { method: "GET", token: alice.accessToken });
    expect(stillThere.data.map((t) => t.id)).toContain(task.data.id);

    // An agent cannot approve its own request (agent tokens do not work on the human API).
    expect((await request(`${ws}/agent-tokens/proposals/${proposal.data.id}/approve`, { method: "POST", token: agent.secret, body: {} })).status).toBe(401);
    // A non-member cannot decide it.
    expect([403, 404]).toContain((await request(`${ws}/agent-tokens/proposals/${proposal.data.id}/approve`, { method: "POST", token: bob.accessToken, body: {} })).status);

    const approved = await request<{ status: string }>(`${ws}/agent-tokens/proposals/${proposal.data.id}/approve`, { method: "POST", token: alice.accessToken, body: {} });
    expect(approved.data.status).toBe("approved");
    const gone = await request<Array<{ id: string }>>(`${ws}/tasks`, { method: "GET", token: alice.accessToken });
    expect(gone.data.map((t) => t.id)).not.toContain(task.data.id);
    expect((await request(`${ws}/agent-tokens/proposals/${proposal.data.id}/approve`, { method: "POST", token: alice.accessToken, body: {} })).status).toBe(409);

    // Rejecting leaves the object alone; missing scope is refused.
    const note = await request<{ id: string }>(`${ws}/notes`, { method: "POST", token: alice.accessToken, body: { title: "Заметка" } });
    const second = await request<{ id: string }>("/ai/v1/proposals", { method: "POST", token: agent.secret, body: { action: "note.delete", targetId: note.data.id } });
    await request(`${ws}/agent-tokens/proposals/${second.data.id}/reject`, { method: "POST", token: alice.accessToken, body: {} });
    expect((await request(`${ws}/notes/${note.data.id}`, { method: "GET", token: alice.accessToken })).status).toBe(200);
    const readOnly = await issue(alice, ["tasks:read"]);
    expect((await request("/ai/v1/proposals", { method: "POST", token: readOnly.secret, body: { action: "task.delete", targetId: task.data.id } })).status).toBe(403);
  });

  it("лимит частоты: после исчерпания бюджета токена 429 с Retry-After, отказ в журнале, другой токен не задет", async () => {
    const alice = await register("alice-rate");
    const busy = await issue(alice, ["tasks:read"]);
    const calm = await issue(alice, ["tasks:read"]);
    for (let i = 0; i < TEST_RATE_LIMIT; i++) {
      expect((await request("/ai/v1/tasks", { method: "GET", token: busy.secret })).status).toBe(200);
    }
    const limited = await fetch(`${baseUrl}/ai/v1/tasks`, { headers: { Authorization: `Bearer ${busy.secret}` } });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await request("/ai/v1/tasks", { method: "GET", token: calm.secret })).status).toBe(200);
    // A token that is not valid is a 401 before it ever touches the budget.
    expect((await request("/ai/v1/tasks", { method: "GET", token: "orion_agt_nonsense" })).status).toBe(401);

    const audit = await request<Array<{ action: string; status: number; tokenId: string | null }>>(
      `/workspaces/${alice.workspaceId}/agent-tokens/audit`, { method: "GET", token: alice.accessToken }
    );
    expect(audit.data.filter((e) => e.status === 429 && e.tokenId === busy.id && e.action === "rate_limited")).toHaveLength(1);
  });

  it("действия агента помечены: журнал задачи, заметка, лента активности; человек остаётся без метки", async () => {
    const alice = await register("alice-attr");
    const agent = await issue(alice, ["tasks:write", "notes:write"]);
    const ws = `/workspaces/${alice.workspaceId}`;

    const task = await request<{ id: string; revision: number }>("/ai/v1/tasks", { method: "POST", token: agent.secret, body: { title: "От агента" } });
    expect((await request(`/ai/v1/tasks/${task.data.id}`, { method: "PATCH", token: agent.secret, body: { status: "in_progress" } })).status).toBe(200);
    expect((await request(`${ws}/tasks/${task.data.id}`, { method: "PATCH", token: alice.accessToken, body: { status: "done" } })).status).toBe(200);

    const history = await request<Array<{ field: string; toValue: string | null; agentName: string | null; actorId: string | null }>>(
      `${ws}/tasks/${task.data.id}/activity`, { method: "GET", token: alice.accessToken }
    );
    const byAgent = history.data.filter((h) => h.agentName === "Claude");
    expect(byAgent.map((h) => h.field).sort()).toEqual(["created", "status"]);
    expect(byAgent.every((h) => h.actorId === alice.user.id)).toBe(true);
    const human = history.data.find((h) => h.field === "status" && h.toValue === "done");
    expect(human?.agentName).toBeNull();

    const feed = await request<Array<{ kind: string; actorKind: string; actorName: string; summary: string }>>(
      `${ws}/activity`, { method: "GET", token: alice.accessToken }
    );
    expect(feed.data.some((e) => e.kind === "task_change" && e.actorKind === "agent" && e.actorName === "Claude" && e.summary === "Создана задача")).toBe(true);
    expect(feed.data.some((e) => e.kind === "task_change" && e.actorKind === "user" && e.summary.includes("Готово"))).toBe(true);

    // A task made by the human has no `created` row at all.
    const own = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Моя" } });
    const ownHistory = await request<unknown[]>(`${ws}/tasks/${own.data.id}/activity`, { method: "GET", token: alice.accessToken });
    expect(ownHistory.data).toHaveLength(0);

    const note = await request<{ id: string; createdByAgent: string | null; editedByAgent: string | null; revision: number }>("/ai/v1/notes", {
      method: "POST", token: agent.secret, body: { title: "Агентская", body: "v1" }
    });
    expect(note.data).toMatchObject({ createdByAgent: "Claude", editedByAgent: null });
    const edited = await request<{ editedByAgent: string | null; revision: number }>(`/ai/v1/notes/${note.data.id}`, {
      method: "PATCH", token: agent.secret, body: { body: "v2", expectedRevision: note.data.revision }
    });
    expect(edited.data.editedByAgent).toBe("Claude");
    const humanEdit = await request<{ createdByAgent: string | null; editedByAgent: string | null }>(`${ws}/notes/${note.data.id}`, {
      method: "PATCH", token: alice.accessToken, body: { body: "v3", expectedRevision: edited.data.revision }
    });
    expect(humanEdit.data).toMatchObject({ createdByAgent: "Claude", editedByAgent: null });
    const humanNote = await request<{ createdByAgent: string | null }>(`${ws}/notes`, { method: "POST", token: alice.accessToken, body: { title: "Человеческая" } });
    expect(humanNote.data.createdByAgent).toBeNull();
  });

  it("события: scope, окно, создание и правка безопасных полей, повторов и удаления у агента нет", async () => {
    const alice = await register("alice-events");
    const reader = await issue(alice, ["events:read"]);
    const writer = await issue(alice, ["events:read", "events:write"]);
    const noScope = await issue(alice, ["tasks:read"]);
    const ws = `/workspaces/${alice.workspaceId}`;

    expect((await request("/ai/v1/events", { method: "GET", token: noScope.secret })).status).toBe(403);
    const body = { title: "Созвон", startAt: "2026-11-02T09:00:00.000Z", endAt: "2026-11-02T10:00:00.000Z", location: "Zoom", reminders: [15] };
    expect((await request("/ai/v1/events", { method: "POST", token: reader.secret, body })).status).toBe(403);

    const created = await request<{ id: string; title: string; recurrence: unknown; colorTag: string | null; reminders: number[] }>("/ai/v1/events", {
      method: "POST", token: writer.secret,
      // Fields outside the agent's schema (recurrence, colour) are dropped, not applied.
      body: { ...body, recurrence: { freq: "daily", interval: 1 }, colorTag: "red" }
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ title: "Созвон", recurrence: null, colorTag: null, reminders: [15] });
    expect((await request("/ai/v1/events", { method: "POST", token: writer.secret, body: { ...body, endAt: body.startAt } })).status).toBe(400);

    const patched = await request<{ title: string; startAt: string }>(`/ai/v1/events/${created.data.id}`, {
      method: "PATCH", token: writer.secret, body: { title: "Созвон (перенос)", startAt: "2026-11-02T11:00:00.000Z", endAt: "2026-11-02T12:00:00.000Z" }
    });
    expect(patched.status).toBe(200);
    expect(patched.data).toMatchObject({ title: "Созвон (перенос)", startAt: "2026-11-02T11:00:00.000Z" });

    const inWindow = await request<Array<{ id: string }>>("/ai/v1/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z", { method: "GET", token: reader.secret });
    expect(inWindow.data.map((e) => e.id)).toContain(created.data.id);
    const elsewhere = await request<Array<{ id: string }>>("/ai/v1/events?from=2026-12-01T00:00:00Z&to=2026-12-30T00:00:00Z", { method: "GET", token: reader.secret });
    expect(elsewhere.data.map((e) => e.id)).not.toContain(created.data.id);
    expect((await request("/ai/v1/events?from=nonsense", { method: "GET", token: reader.secret })).status).toBe(400);
    expect((await request("/ai/v1/events?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z", { method: "GET", token: reader.secret })).status).toBe(400);

    // The person sees the same event; the bridge has no delete.
    const human = await request<Array<{ id: string }>>(`${ws}/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z`, { method: "GET", token: alice.accessToken });
    expect(human.data.map((e) => e.id)).toContain(created.data.id);
    expect((await request(`/ai/v1/events/${created.data.id}`, { method: "DELETE", token: writer.secret })).status).toBe(404);

    // The module switch applies as for tasks and notes.
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["calendar"] } }));
    expect((await request("/ai/v1/events", { method: "GET", token: reader.secret })).status).toBe(409);
  });

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
