import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Задание 12 «Команда и разграничение прав человек/ИИ».
 *
 * Проверяется на живой PostgreSQL:
 *  12.1 — единый список команды с kind/status и агентским членством из профиля Agent Hub; агент с
 *         правами read не может выполнить мутацию, даже если создатель — owner (403 про scope, не 500);
 *  12.2 — срок приглашения (7 дней по умолчанию, null = бессрочно), отзыв до принятия с аудитом,
 *         повторная отправка, истёкшее приглашение — 410;
 *  12.3 — `@имя` в комментарии: уведомление только члену пространства, агент — событие в очередь;
 *         уведомление без видимого объекта не раскрывает его содержимое;
 *  12.4 — параллельные правки проекта: второй клиент получает 409 с текущей версией.
 */
describe("Team and access (задание 12)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `team-access-${runId}`;

  interface Person {
    accessToken: string;
    userId: string;
    email: string;
    name: string;
    workspaceId: string;
  }

  let alice: Person;
  let bob: Person;
  let workspaceId: string;
  let agentProfileId: string;
  let agentMemberId: string;
  const TASK_TITLE = "Задача для команды";

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);

    alice = await register("Алиса", "owner");
    workspaceId = alice.workspaceId;
    bob = await register("Боб", "member");
    await inviteAndJoin(alice, bob);

    // Профиль Agent Hub — данные подключаемого модуля; членство агента создаёт триггер БД.
    const profile = await prisma.asSystem((tx) =>
      tx.agentHubAgentProfile.create({ data: { workspaceId, name: "Рита", createdById: alice.userId } })
    );
    agentProfileId = profile.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((member) => member.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string, suffix: string): Promise<Person> {
    const email = `${emailPrefix}-${suffix}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, userId: response.data.user.id, email, name, workspaceId: workspaces.data[0]!.id };
  }

  async function inviteAndJoin(owner: Person, guest: Person): Promise<void> {
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${owner.workspaceId}/invites`, {
      method: "POST",
      token: owner.accessToken,
      body: { email: guest.email }
    });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${token}/accept`, { method: "POST", token: guest.accessToken });
    expect(accepted.status).toBe(201);
  }

  // ── 12.1 ───────────────────────────────────────────────────────────────────────────────────────

  it("показывает людей и агентов одной командой, с kind и статусом; старый /members остаётся человеческим", async () => {
    const team = await request<Array<Record<string, unknown>>>(`/workspaces/${workspaceId}/team`, { method: "GET", token: alice.accessToken });
    expect(team.status).toBe(200);
    const humans = team.data.filter((entry) => entry.kind === "human" && entry.status === "active");
    expect(humans).toHaveLength(2);
    const agent = team.data.find((entry) => entry.kind === "agent");
    expect(agent).toMatchObject({ status: "active", agentProfileId, name: "Рита", role: "member" });
    expect(typeof agent!.memberId).toBe("string");
    agentMemberId = agent!.memberId as string;

    const onlyAgents = await request<Array<Record<string, unknown>>>(`/workspaces/${workspaceId}/team?kind=agent`, { method: "GET", token: alice.accessToken });
    expect(onlyAgents.data).toHaveLength(1);
    expect(onlyAgents.data[0]!.kind).toBe("agent");

    // Старый контракт не изменился: только люди, у каждого есть userId.
    const members = await request<Array<Record<string, unknown>>>(`/workspaces/${workspaceId}/members`, { method: "GET", token: alice.accessToken });
    expect(members.status).toBe(200);
    expect(members.data).toHaveLength(2);
    expect(members.data.every((member) => member.kind === "human" && typeof member.userId === "string")).toBe(true);

    // Роль агента не меняется и строку ростера нельзя удалить: его подключение — ADR-0047.
    const roleChange = await request(`/workspaces/${workspaceId}/members/${agentMemberId}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "lead" }
    });
    expect(roleChange.status).toBe(400);
    const removal = await request(`/workspaces/${workspaceId}/members/${agentMemberId}`, { method: "DELETE", token: alice.accessToken });
    expect(removal.status).toBe(400);

    // Очередь событий агента пуста, но читается участником пространства.
    const events = await request<unknown[]>(`/workspaces/${workspaceId}/team/agents/${agentMemberId}/events`, { method: "GET", token: bob.accessToken });
    expect(events.status).toBe(200);
    expect(events.data).toEqual([]);
  });

  it("агент с правом только читать не меняет задачу, даже когда создатель — owner (403 про scope, не 500)", async () => {
    const created = await request<{ id: string; title: string }>(`/workspaces/${workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: TASK_TITLE }
    });
    expect(created.status).toBe(201);

    const token = await request<{ secret: string }>(`/workspaces/${workspaceId}/agent-tokens`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Рита", scopes: ["tasks:read"], mode: "manager", expiresInDays: 1 }
    });
    expect(token.status).toBe(201);

    // Собственные права токена видны агенту: они урезаны, хотя создатель — владелец.
    const me = await request<{ scopes: string[]; mode: string }>("/ai/v1/me", { method: "GET", token: token.data.secret });
    expect(me.status).toBe(200);
    expect(me.data.scopes).toEqual(["tasks:read"]);

    const patch = await request<{ message?: string }>(`/ai/v1/tasks/${created.data.id}`, {
      method: "PATCH",
      token: token.data.secret,
      body: { title: "Переписано агентом" }
    });
    expect(patch.status).toBe(403);
    expect(JSON.stringify(patch.data)).toContain("tasks.task.update");

    // Ничего не записалось.
    const list = await request<Array<{ id: string; title: string }>>(`/workspaces/${workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(list.data.find((task) => task.id === created.data.id)?.title).toBe(TASK_TITLE);
  });

  // ── 12.2 ───────────────────────────────────────────────────────────────────────────────────────

  it("приглашение: срок по умолчанию 7 дней, null — бессрочно, повторная отправка и отзыв с аудитом", async () => {
    const carolEmail = `${emailPrefix}-carol@example.test`;
    const created = await request<{ id: string; code: string; expiresAt: string | null; resendCount: number }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: carolEmail }
    });
    expect(created.status).toBe(201);
    const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const driftHours = Math.abs(new Date(created.data.expiresAt!).getTime() - sevenDays) / 3_600_000;
    expect(driftHours).toBeLessThan(1);

    const resent = await request<{ code: string; expiresAt: string | null; resendCount: number; resentById: string | null }>(
      `/workspaces/${workspaceId}/invites/${created.data.id}/resend`,
      { method: "POST", token: alice.accessToken, body: { expiresInDays: 3 } }
    );
    expect(resent.status).toBe(201);
    expect(resent.data.resendCount).toBe(1);
    expect(resent.data.resentById).toBe(alice.userId);
    const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(resent.data.expiresAt!).getTime() - threeDays) / 3_600_000).toBeLessThan(1);
    // Старая ссылка перестала существовать: токен заменён.
    expect((await request(`/invites/${created.data.code}`, { method: "GET" })).status).toBe(404);

    const revoked = await request(`/workspaces/${workspaceId}/invites/${created.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect(revoked.status).toBeLessThan(300);
    const list = await request<Array<{ id: string; revokedById: string | null; status: string }>>(`/workspaces/${workspaceId}/invites`, {
      method: "GET",
      token: alice.accessToken
    });
    const row = list.data.find((invite) => invite.id === created.data.id);
    expect(row).toMatchObject({ status: "revoked", revokedById: alice.userId });

    // Бессрочное приглашение — явный null, а не «через сто лет».
    const forever = await request<{ expiresAt: string | null; code: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: `${emailPrefix}-erin@example.test`, expiresInDays: null }
    });
    expect(forever.status).toBe(201);
    expect(forever.data.expiresAt).toBeNull();
    expect((await request<{ status: string }>(`/invites/${forever.data.code}`, { method: "GET" })).data.status).toBe("pending");
  });

  it("истёкшее приглашение не принимается (410) и отозванное — 409", async () => {
    const dave = await register("Дэйв", "dave");
    const invite = await request<{ id: string; code: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: dave.email }
    });
    // Отзыв до принятия.
    await request(`/workspaces/${workspaceId}/invites/${invite.data.id}`, { method: "DELETE", token: alice.accessToken });
    expect((await request(`/invites/${invite.data.code}/accept`, { method: "POST", token: dave.accessToken })).status).toBe(409);

    const second = await request<{ id: string; code: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: dave.email }
    });
    await prisma.asSystem((tx) =>
      tx.workspaceInvite.update({ where: { id: second.data.id }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    );
    expect((await request<{ status: string }>(`/invites/${second.data.code}`, { method: "GET" })).data.status).toBe("expired");
    const expired = await request<{ message?: string }>(`/invites/${second.data.code}/accept`, { method: "POST", token: dave.accessToken });
    expect(expired.status).toBe(410);
    expect(JSON.stringify(expired.data)).toContain("истёк");
  });

  // ── 12.3 ───────────────────────────────────────────────────────────────────────────────────────

  it("упоминание в комментарии уведомляет только участника пространства; агент получает событие в очередь", async () => {
    const task = await request<{ id: string }>(`/workspaces/${workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Обсуждение" }
    });
    const taskId = task.data.id;

    const comment = await request(`/workspaces/${workspaceId}/tasks/${taskId}/comments`, {
      method: "POST",
      token: alice.accessToken,
      body: { body: "@Боб посмотри, пожалуйста. @" + "Рита тоже." }
    });
    expect(comment.status).toBe(201);

    const bobNotifications = await request<Array<{ id: string; kind: string; entityType: string | null; entityId: string | null; title: string; body: string }>>(
      `/workspaces/${workspaceId}/notifications`,
      { method: "GET", token: bob.accessToken }
    );
    const mention = bobNotifications.data.find((entry) => entry.entityId === taskId);
    expect(mention).toBeDefined();
    expect(mention!.body).toContain("посмотри");
    // Автору своё упоминание не приходит, а «Рита» — агент: у неё очередь, не лента.
    const aliceNotifications = await request<Array<{ entityId: string | null }>>(`/workspaces/${workspaceId}/notifications`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(aliceNotifications.data.some((entry) => entry.entityId === taskId)).toBe(false);

    const agentEvents = await request<Array<{ kind: string; entityType: string; entityId: string; title: string }>>(
      `/workspaces/${workspaceId}/team/agents/${agentMemberId}/events`,
      { method: "GET", token: bob.accessToken }
    );
    expect(agentEvents.status).toBe(200);
    expect(agentEvents.data).toHaveLength(1);
    expect(agentEvents.data[0]).toMatchObject({ kind: "mention", entityType: "task", entityId: taskId });

    // Постороннее имя не резолвится и никому не адресуется.
    await request(`/workspaces/${workspaceId}/tasks/${taskId}/comments`, {
      method: "POST",
      token: alice.accessToken,
      body: { body: "@Призрак ты здесь?" }
    });
    const afterGhost = await request<Array<unknown>>(`/workspaces/${workspaceId}/notifications`, { method: "GET", token: bob.accessToken });
    expect(afterGhost.data).toHaveLength(bobNotifications.data.length);
    const eventsAfterGhost = await request<Array<unknown>>(`/workspaces/${workspaceId}/team/agents/${agentMemberId}/events`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(eventsAfterGhost.data).toHaveLength(1);

    // Объект исчез — уведомление остаётся строкой получателя, но без содержимого.
    await prisma.asSystem((tx) => tx.task.delete({ where: { id: taskId } }));
    const redacted = await request<Array<{ id: string; title: string; body: string; entityId: string | null }>>(
      `/workspaces/${workspaceId}/notifications`,
      { method: "GET", token: bob.accessToken }
    );
    const redactedRow = redacted.data.find((entry) => entry.id === mention!.id);
    expect(redactedRow).toBeDefined();
    expect(redactedRow!.title).toBe("Содержимое недоступно");
    expect(redactedRow!.body).not.toContain("посмотри");
    expect(redactedRow!.entityId).toBeNull();
  });

  // ── 12.4 ───────────────────────────────────────────────────────────────────────────────────────

  it("параллельные правки проекта: второй клиент получает 409 с текущей версией, правка без токена — LWW", async () => {
    const base = `/workspaces/${workspaceId}/projects`;
    const created = await request<{ id: string; revision: number }>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { name: `Проект CAS ${runId}` }
    });
    expect(created.status).toBe(201);
    expect(created.data.revision).toBe(1);

    const first = await request<{ revision: number; name: string }>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { name: `Первая правка ${runId}`, expectedRevision: 1 }
    });
    expect(first.status).toBe(200);
    expect(first.data.revision).toBe(2);

    const stale = await request<{ code: string; currentRevision: number; current: { name: string } }>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { name: `Вторая правка ${runId}`, expectedRevision: 1 }
    });
    expect(stale.status).toBe(409);
    expect(stale.data.code).toBe("project_revision_conflict");
    expect(stale.data.currentRevision).toBe(2);
    expect(stale.data.current.name).toBe(`Первая правка ${runId}`);

    const lww = await request<{ revision: number; description: string }>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { description: "без CAS" }
    });
    expect(lww.status).toBe(200);
    expect(lww.data.revision).toBe(3);
    expect(lww.data.description).toBe("без CAS");
  });
});
