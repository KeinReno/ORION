import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface Session {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

interface Subject {
  id: string;
  name: string;
  kind: "member" | "dependent";
  access: "own" | "write" | "read";
}

/**
 * «Здоровье» (ADR-0012): доступ идёт за ЧЕЛОВЕКОМ, а не за пространством. Негативные случаи важнее
 * позитивных: владелец пространства, участник без допуска, `read`-допуск, вышедший участник, чужое
 * пространство — и на уровне HTTP, и на уровне самой БД (RLS).
 */
describe("Module Health", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `health-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
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

  async function setup(prefix: string): Promise<{ alice: Session; bob: Session; ws: string }> {
    const alice = await register(`${prefix}-alice`);
    const bob = await register(`${prefix}-bob`);
    const ws = `/workspaces/${alice.workspaceId}`;
    // Модуль выключен по умолчанию: включаем явно.
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [] } }));
    const invite = await request<{ acceptUrl: string }>(`${ws}/invites`, { method: "POST", token: alice.accessToken, body: { email: bob.email } });
    const token = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${token}/accept`, { method: "POST", token: bob.accessToken })).status).toBe(201);
    return { alice, bob, ws };
  }

  it("модуль выключен по умолчанию у нового пространства и не раскрывает данные", async () => {
    const alice = await register("off-alice");
    const ws = `/workspaces/${alice.workspaceId}`;
    expect((await request(`${ws}/health/subjects`, { method: "GET", token: alice.accessToken })).status).toBe(409);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [] } }));
    expect((await request(`${ws}/health/subjects`, { method: "GET", token: alice.accessToken })).status).toBe(200);
  });

  it("чужой человек невидим: ни участнику, ни владельцу пространства; чужое пространство — 403", async () => {
    const { alice, bob, ws } = await setup("priv");
    const mallory = await register("priv-mallory");

    // Bob (обычный участник) ведёт свои данные; alice — ВЛАДЕЛЕЦ пространства.
    const bobSelf = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: bob.accessToken, body: { kind: "member", name: "Борис" } });
    expect(bobSelf.status).toBe(201);
    expect(bobSelf.data).toMatchObject({ kind: "member", access: "own" });
    const visit = await request<{ id: string }>(`${ws}/health/subjects/${bobSelf.data.id}/appointments`, {
      method: "POST", token: bob.accessToken, body: { title: "Терапевт", at: "2026-10-20T09:00:00.000Z" }
    });
    expect(visit.status).toBe(201);

    const aliceList = await request<Subject[]>(`${ws}/health/subjects`, { method: "GET", token: alice.accessToken });
    expect(aliceList.data.map((s) => s.id)).not.toContain(bobSelf.data.id);
    for (const [method, path, body] of [
      ["GET", `subjects/${bobSelf.data.id}/appointments`, undefined],
      ["POST", `subjects/${bobSelf.data.id}/appointments`, { title: "x", at: "2026-10-21T09:00:00.000Z" }],
      ["PATCH", `subjects/${bobSelf.data.id}`, { name: "Взлом" }],
      ["DELETE", `subjects/${bobSelf.data.id}`, undefined],
      ["GET", `subjects/${bobSelf.data.id}/grants`, undefined],
      ["PATCH", `subjects/${bobSelf.data.id}/appointments/${visit.data.id}`, { outcome: "x" }]
    ] as const) {
      expect((await request(`${ws}/health/${path}`, { method, token: alice.accessToken, body })).status, `${method} ${path}`).toBe(404);
    }
    expect((await request<{ appointments: unknown[] }>(`${ws}/health/today`, { method: "GET", token: alice.accessToken })).data.appointments).toEqual([]);

    // Посторонний не из пространства.
    expect((await request(`${ws}/health/subjects`, { method: "GET", token: mallory.accessToken })).status).toBe(403);

    // То же на уровне БД: RLS не отдаёт и не даёт менять.
    const asAlice = await prisma.withUser(alice.user.id, async (tx) => ({
      subjects: await tx.healthSubject.count({ where: { id: bobSelf.data.id } }),
      visits: await tx.healthAppointment.count({ where: { subjectId: bobSelf.data.id } }),
      deleted: (await tx.healthAppointment.deleteMany({ where: { subjectId: bobSelf.data.id } })).count,
      renamed: (await tx.healthSubject.updateMany({ where: { id: bobSelf.data.id }, data: { name: "Взлом" } })).count
    }));
    expect(asAlice).toEqual({ subjects: 0, visits: 0, deleted: 0, renamed: 0 });
    await expect(
      prisma.withUser(alice.user.id, (tx) => tx.healthAppointment.create({ data: { workspaceId: alice.workspaceId, subjectId: bobSelf.data.id, title: "подмена", at: new Date() } }))
    ).rejects.toThrow();
    // Нельзя завести человека от чужого имени.
    await expect(
      prisma.withUser(alice.user.id, (tx) => tx.healthSubject.create({ data: { workspaceId: alice.workspaceId, userId: bob.user.id, name: "Подмена" } }))
    ).rejects.toThrow();

    // Хозяин по-прежнему всё видит.
    const mine = await request<Array<{ id: string }>>(`${ws}/health/subjects/${bobSelf.data.id}/appointments`, { method: "GET", token: bob.accessToken });
    expect(mine.data.map((v) => v.id)).toEqual([visit.data.id]);
  });

  it("допуск: read только смотрит, write ведёт визиты, но не владеет; отзыв закрывает сразу", async () => {
    const { alice, bob, ws } = await setup("grant");
    const self = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    expect((await request(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Дубль" } })).status).toBe(409);
    const base = `${ws}/health/subjects/${self.data.id}`;
    const visit = await request<{ id: string }>(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Окулист", at: "2026-10-22T08:00:00.000Z" } });

    // Допустить можно только участника пространства и не владельца.
    expect((await request(`${base}/grants/${alice.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } })).status).toBe(400);
    expect((await request(`${base}/grants/not-a-member`, { method: "PUT", token: alice.accessToken, body: { level: "read" } })).status).toBe(400);
    // Сам себе допуск Bob выдать не может.
    expect((await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: bob.accessToken, body: { level: "write" } })).status).toBe(404);

    expect((await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } })).status).toBe(200);
    const seen = await request<Subject[]>(`${ws}/health/subjects`, { method: "GET", token: bob.accessToken });
    expect(seen.data.find((s) => s.id === self.data.id)).toMatchObject({ access: "read" });
    expect((await request(`${base}/appointments`, { method: "GET", token: bob.accessToken })).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", "appointments", { title: "x", at: "2026-10-23T08:00:00.000Z" }],
      ["PATCH", `appointments/${visit.data.id}`, { outcome: "x" }],
      ["DELETE", `appointments/${visit.data.id}`, undefined],
      ["POST", "preventive", { name: "x" }]
    ] as const) {
      expect((await request(`${base}/${path}`, { method, token: bob.accessToken, body })).status, `read: ${method} ${path}`).toBe(403);
    }
    expect((await request(base, { method: "PATCH", token: bob.accessToken, body: { name: "x" } })).status).toBe(403);
    expect((await request(base, { method: "DELETE", token: bob.accessToken })).status).toBe(403);
    expect((await request(`${base}/grants`, { method: "GET", token: bob.accessToken })).status).toBe(403);
    // На уровне БД read тоже не удаляет и не меняет.
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthAppointment.deleteMany({ where: { subjectId: self.data.id } })).count)).toBe(0);

    expect((await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "write" } })).status).toBe(200);
    const added = await request<{ id: string }>(`${base}/appointments`, { method: "POST", token: bob.accessToken, body: { title: "Анализы", at: "2026-10-24T08:00:00.000Z" } });
    expect(added.status).toBe(201);
    expect((await request(`${base}/appointments/${added.data.id}`, { method: "DELETE", token: bob.accessToken })).status).toBe(204);
    // write не делает хозяином.
    expect((await request(base, { method: "DELETE", token: bob.accessToken })).status).toBe(403);
    expect((await request(`${base}/grants/${alice.user.id}`, { method: "PUT", token: bob.accessToken, body: { level: "read" } })).status).toBe(403);

    expect((await request(`${base}/grants/${bob.user.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(`${base}/appointments`, { method: "GET", token: bob.accessToken })).status).toBe(404);
  });

  it("иждивенец: ведёт опекун; вышедший из пространства теряет доступ даже с допуском", async () => {
    const { alice, bob, ws } = await setup("dep");
    const child = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "dependent", name: "Маша", birthDate: "2020-05-01", allergies: [{ substance: "Арахис", reaction: "сыпь" }] } });
    expect(child.status).toBe(201);
    expect(child.data).toMatchObject({ kind: "dependent", access: "own" });
    // Иждивенцев может быть несколько.
    expect((await request(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "dependent", name: "Дед" } })).status).toBe(201);
    expect((await request(`${ws}/health/subjects/${child.data.id}`, { method: "GET", token: bob.accessToken })).status).toBe(404);

    expect((await request(`${ws}/health/subjects/${child.data.id}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } })).status).toBe(200);
    expect(await prisma.withUser(bob.user.id, (tx) => tx.healthSubject.count({ where: { id: child.data.id } }))).toBe(1);
    await prisma.asSystem((tx) => tx.workspaceMember.deleteMany({ where: { workspaceId: alice.workspaceId, userId: bob.user.id } }));
    expect(await prisma.withUser(bob.user.id, (tx) => tx.healthSubject.count({ where: { id: child.data.id } }))).toBe(0);
    expect((await request(`${ws}/health/subjects/${child.data.id}/appointments`, { method: "GET", token: bob.accessToken })).status).toBe(403);
  });

  it("«Сегодня» и профилактика: срок вычисляется, «выполнено» сдвигает его; чужой контакт врача отклоняется", async () => {
    const { alice, ws } = await setup("today");
    const other = await register("today-other");
    const foreignContact = await request<{ id: string }>(`/workspaces/${other.workspaceId}/contacts`, { method: "POST", token: other.accessToken, body: { name: "Чужой врач" } });
    const self = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const base = `${ws}/health/subjects/${self.data.id}`;

    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect((await request(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Визит с чужим врачом", at: soon, doctorContactId: foreignContact.data.id } })).status).toBe(400);
    const visit = await request<{ id: string }>(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Кардиолог", at: soon } });
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    await request(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Через два месяца", at: far } });

    const overdue = await request<{ id: string; nextDueAt: string | null }>(`${base}/preventive`, {
      method: "POST", token: alice.accessToken, body: { name: "Стоматолог", everyMonths: 6, lastDoneAt: "2025-01-10" }
    });
    expect(overdue.data.nextDueAt).toBe("2025-07-10");
    await request(`${base}/preventive`, { method: "POST", token: alice.accessToken, body: { name: "Флюорография", firstDueAt: "2099-01-01" } });

    const today = await request<{ appointments: Array<{ title: string; subjectName: string }>; preventive: Array<{ name: string; status: string }> }>(`${ws}/health/today?today=2026-10-15`, { method: "GET", token: alice.accessToken });
    expect(today.data.appointments.map((a) => a.title)).toEqual(["Кардиолог"]);
    expect(today.data.appointments[0].subjectName).toBe("Анна");
    expect(today.data.preventive).toEqual([expect.objectContaining({ name: "Стоматолог", status: "overdue" })]);

    const done = await request<{ lastDoneAt: string; nextDueAt: string }>(`${base}/preventive/${overdue.data.id}/done`, { method: "POST", token: alice.accessToken, body: { doneOn: "2026-10-15" } });
    expect(done.data).toMatchObject({ lastDoneAt: "2026-10-15", nextDueAt: "2027-04-15" });
    expect((await request<{ preventive: unknown[] }>(`${ws}/health/today?today=2026-10-15`, { method: "GET", token: alice.accessToken })).data.preventive).toEqual([]);

    // Закрытый визит уходит из «Сегодня».
    await request(`${base}/appointments/${visit.data.id}`, { method: "PATCH", token: alice.accessToken, body: { doneAt: new Date().toISOString(), outcome: "всё хорошо" } });
    expect((await request<{ appointments: unknown[] }>(`${ws}/health/today`, { method: "GET", token: alice.accessToken })).data.appointments).toEqual([]);

    // Удаление человека уносит его записи.
    expect((await request(base, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect(await prisma.asSystem((tx) => tx.healthAppointment.count({ where: { subjectId: self.data.id } }))).toBe(0);
  });

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
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
