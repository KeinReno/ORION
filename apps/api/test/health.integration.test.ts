import { Module, type INestApplication, type ModuleMetadata } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SchedulerRegistry } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { ContactsModule } from "../src/contacts/contacts.module";
import { ContactsService } from "../src/contacts/contacts.service";
import { ContactReferences } from "../src/contacts/public/contact-references";

class WithoutContactsApp {}
const appImports = Reflect.getMetadata("imports", AppModule) as NonNullable<ModuleMetadata["imports"]>;
Module({ imports: appImports.filter((entry) => entry !== ContactsModule) })(WithoutContactsApp);

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
    // Модуль выключен по умолчанию: включаем явно. Личное пространство приглашений не принимает — делаем общим.
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [], isPersonal: false } }));
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

    // No `?today=` override: the endpoint defaults to the real day, matching `soon`/`far`
    // above (both computed from `Date.now()`) — a hardcoded date here rots as the calendar
    // moves past it, since `soon` (+3d) can fall outside a window pinned to a stale "today".
    const today = await request<{ appointments: Array<{ title: string; subjectName: string }>; preventive: Array<{ name: string; status: string }> }>(`${ws}/health/today`, { method: "GET", token: alice.accessToken });
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

  it("лекарства: отметка идемпотентна, остаток сходится, соблюдение считается, наблюдатель не отмечает", async () => {
    const { alice, bob, ws } = await setup("meds");
    const self = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const base = `${ws}/health/subjects/${self.data.id}/medications`;
    const day = "2026-10-15";

    // График обязателен, если не «по требованию».
    expect((await request(base, { method: "POST", token: alice.accessToken, body: { name: "Без графика" } })).status).toBe(400);
    expect((await request(base, { method: "POST", token: alice.accessToken, body: { name: "Кривое время", times: ["8:00"] } })).status).toBe(400);

    const med = await request<{ id: string; stock: number | null; lowStock: boolean; times: string[] }>(base, {
      method: "POST", token: alice.accessToken, body: { name: "Витамин D", dose: "1 капсула", times: ["20:00", "08:00"], stock: 2, lowStockAt: 1 }
    });
    expect(med.status).toBe(201);
    expect(med.data.times).toEqual(["08:00", "20:00"]);
    const intakes = `${base}/${med.data.id}/intakes`;
    const stock = async () => (await request<Array<{ id: string; stock: number | null; lowStock: boolean }>>(`${base}?today=${day}`, { method: "GET", token: alice.accessToken })).data.find((m) => m.id === med.data.id)!;

    const slots = await request<Array<{ time: string; status: string | null }>>(`${base}/schedule?day=${day}`, { method: "GET", token: alice.accessToken });
    expect(slots.data.map((d) => [d.time, d.status])).toEqual([["08:00", null], ["20:00", null]]);

    expect((await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "08:00", status: "taken" } })).status).toBe(204);
    expect(await stock()).toMatchObject({ stock: 1, lowStock: true });
    // Повторная отметка того же — ничего не меняет.
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "08:00", status: "taken" } });
    expect((await stock()).stock).toBe(1);
    // «Принял» → «пропустил» возвращает единицу; обратно — снова списывает.
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "08:00", status: "skipped" } });
    expect((await stock()).stock).toBe(2);
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "08:00", status: "taken" } });
    expect((await stock()).stock).toBe(1);
    // Снятая отметка возвращает единицу и слот становится неотмеченным.
    expect((await request(`${intakes}?day=${day}&time=08:00`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await stock()).stock).toBe(2);
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "08:00", status: "taken" } });

    // «Сегодня»: остаётся только неотмеченный вечерний приём.
    const today = await request<{ doses: Array<{ name: string; time: string; subjectName: string }> }>(`${ws}/health/today?today=${day}`, { method: "GET", token: alice.accessToken });
    expect(today.data.doses.map((d) => [d.name, d.time, d.subjectName])).toEqual([["Витамин D", "20:00", "Анна"]]);

    // Остаток не уходит ниже нуля.
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day, time: "20:00", status: "taken" } });
    await request(intakes, { method: "PUT", token: alice.accessToken, body: { day: "2026-10-16", time: "08:00", status: "taken" } });
    expect((await stock()).stock).toBe(0);

    // Правка не должна оставлять лекарство без графика.
    expect((await request(`${base}/${med.data.id}`, { method: "PATCH", token: alice.accessToken, body: { times: [] } })).status).toBe(400);

    // Соблюдение: курс с 10.10, окно — 10..14.10 по два слота = 10.
    const course = await request<{ id: string }>(base, { method: "POST", token: alice.accessToken, body: { name: "Курс", times: ["09:00", "21:00"], startOn: "2026-10-10" } });
    const courseIntakes = `${base}/${course.data.id}/intakes`;
    for (const [d, t, status] of [["2026-10-10", "09:00", "taken"], ["2026-10-11", "09:00", "taken"], ["2026-10-12", "21:00", "taken"], ["2026-10-13", "09:00", "skipped"]] as const) {
      await request(courseIntakes, { method: "PUT", token: alice.accessToken, body: { day: d, time: t, status } });
    }
    const listed = await request<Array<{ id: string; adherence: { planned: number; taken: number; skipped: number } }>>(`${base}?today=${day}`, { method: "GET", token: alice.accessToken });
    expect(listed.data.find((m) => m.id === course.data.id)!.adherence).toEqual({ planned: 10, taken: 3, skipped: 1 });

    // Наблюдатель видит, но не отмечает и не получает напоминаний; чужой без допуска не видит вовсе.
    expect((await request(base, { method: "GET", token: bob.accessToken })).status).toBe(404);
    await request(`${ws}/health/subjects/${self.data.id}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } });
    expect((await request(base, { method: "GET", token: bob.accessToken })).status).toBe(200);
    expect((await request(`${base}/schedule?day=${day}`, { method: "GET", token: bob.accessToken })).status).toBe(200);
    expect((await request(intakes, { method: "PUT", token: bob.accessToken, body: { day, time: "20:00", status: "skipped" } })).status).toBe(403);
    expect((await request(`${intakes}?day=${day}&time=20:00`, { method: "DELETE", token: bob.accessToken })).status).toBe(403);
    expect((await request(base, { method: "POST", token: bob.accessToken, body: { name: "x", asNeeded: true } })).status).toBe(403);
    expect((await request<{ doses: unknown[] }>(`${ws}/health/today?today=${day}`, { method: "GET", token: bob.accessToken })).data.doses).toEqual([]);
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthIntake.deleteMany({ where: { subjectId: self.data.id } })).count)).toBe(0);
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthMedication.updateMany({ where: { subjectId: self.data.id }, data: { name: "Взлом" } })).count)).toBe(0);

    // Архив убирает лекарство из расписания, история остаётся.
    await request(`${base}/${med.data.id}`, { method: "PATCH", token: alice.accessToken, body: { archivedAt: new Date().toISOString() } });
    expect((await request<unknown[]>(`${base}/schedule?day=${day}`, { method: "GET", token: alice.accessToken })).data.every((d) => (d as { name: string }).name !== "Витамин D")).toBe(true);
    expect(await prisma.asSystem((tx) => tx.healthIntake.count({ where: { medicationId: med.data.id } }))).toBeGreaterThan(0);
  });

  it("показатели: опечатки отвергаются, ряд и личный диапазон работают, наблюдатель только смотрит", async () => {
    const { alice, bob, ws } = await setup("meas");
    const self = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const base = `${ws}/health/subjects/${self.data.id}`;
    const post = (body: unknown, token = alice.accessToken) => request<{ id: string; value: number; value2: number | null }>(`${base}/measurements`, { method: "POST", token, body });

    expect((await post({ kind: "weight", value: 7000 })).status).toBe(400);
    expect((await post({ kind: "blood_pressure", value: 120 })).status).toBe(400);
    expect((await post({ kind: "blood_pressure", value: 120, value2: 130 })).status).toBe(400);
    expect((await post({ kind: "pulse", value: 70, value2: 80 })).status).toBe(400);
    expect((await post({ kind: "mood", value: 5 })).status).toBe(400);

    const w1 = await post({ kind: "weight", value: 72.4, measuredAt: "2026-10-01T08:00:00.000Z", context: "натощак" });
    expect(w1.status).toBe(201);
    expect(w1.data.value).toBe(72.4);
    await post({ kind: "weight", value: 71.9, measuredAt: "2026-10-10T08:00:00.000Z" });
    const bp = await post({ kind: "blood_pressure", value: 128, value2: 84, measuredAt: "2026-10-12T08:00:00.000Z" });
    expect(bp.data).toMatchObject({ value: 128, value2: 84 });

    // Свежие первыми; фильтры по виду и окну.
    const all = await request<Array<{ kind: string; value: number }>>(`${base}/measurements`, { method: "GET", token: alice.accessToken });
    expect(all.data.map((m) => m.kind)).toEqual(["blood_pressure", "weight", "weight"]);
    const weights = await request<Array<{ value: number }>>(`${base}/measurements?kind=weight&from=2026-10-05T00:00:00.000Z`, { method: "GET", token: alice.accessToken });
    expect(weights.data.map((m) => m.value)).toEqual([71.9]);
    expect((await request(`${base}/measurements?kind=mood`, { method: "GET", token: alice.accessToken })).status).toBe(400);
    expect((await request(`${base}/measurements?from=вчера`, { method: "GET", token: alice.accessToken })).status).toBe(400);

    // Личный диапазон.
    expect((await request(`${base}/measurement-targets/weight`, { method: "PUT", token: alice.accessToken, body: { min: 80, max: 70 } })).status).toBe(400);
    const target = await request<{ min: number | null; max: number | null }>(`${base}/measurement-targets/weight`, { method: "PUT", token: alice.accessToken, body: { min: 60, max: 72 } });
    expect(target.data).toEqual(expect.objectContaining({ min: 60, max: 72 }));
    await request(`${base}/measurement-targets/weight`, { method: "PUT", token: alice.accessToken, body: { min: null, max: 71 } });
    expect((await request<Array<{ kind: string; min: number | null; max: number | null }>>(`${base}/measurement-targets`, { method: "GET", token: alice.accessToken })).data).toEqual([expect.objectContaining({ kind: "weight", min: null, max: 71 })]);

    // Чужой без допуска не видит; наблюдатель читает, но не пишет и не удаляет — ни по HTTP, ни в БД.
    expect((await request(`${base}/measurements`, { method: "GET", token: bob.accessToken })).status).toBe(404);
    expect((await request(`${base}/measurement-targets`, { method: "GET", token: bob.accessToken })).status).toBe(404);
    await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } });
    expect((await request(`${base}/measurements`, { method: "GET", token: bob.accessToken })).data).toHaveLength(3);
    expect((await post({ kind: "weight", value: 70 }, bob.accessToken)).status).toBe(403);
    expect((await request(`${base}/measurements/${w1.data.id}`, { method: "DELETE", token: bob.accessToken })).status).toBe(403);
    expect((await request(`${base}/measurement-targets/weight`, { method: "PUT", token: bob.accessToken, body: { min: 1, max: 2 } })).status).toBe(403);
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthMeasurement.deleteMany({ where: { subjectId: self.data.id } })).count)).toBe(0);
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthTarget.deleteMany({ where: { subjectId: self.data.id } })).count)).toBe(0);

    // «Ведёт вместе» вносит; удаление чужой записи другого человека невозможно.
    await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "write" } });
    expect((await post({ kind: "pulse", value: 64 }, bob.accessToken)).status).toBe(201);
    expect((await request(`${base}/measurements/${w1.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(`${base}/measurements/${w1.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(404);
  });

  it("симптомы и сводка: эпизоды пишутся, сводка собирает только доступное и только текущее", async () => {
    const { alice, bob, ws } = await setup("sym");
    const self = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна", bloodType: "A(II) Rh+", allergies: [{ substance: "Арахис", reaction: "сыпь" }], emergencyNote: "Муж: +7 900 000-00-00" } });
    const base = `${ws}/health/subjects/${self.data.id}`;

    // Симптомы: сила 0–10, конец не раньше начала.
    const symPost = (body: unknown, token = alice.accessToken) => request<{ id: string; endedAt: string | null }>(`${base}/symptoms`, { method: "POST", token, body });
    expect((await symPost({ name: "Головная боль", severity: 11 })).status).toBe(400);
    expect((await symPost({ name: "Головная боль", severity: 4, startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-09T10:00:00.000Z" })).status).toBe(400);
    const open = await symPost({ name: "Головная боль", severity: 6, triggers: "недосып" });
    expect(open.status).toBe(201);
    expect(open.data.endedAt).toBeNull();
    await symPost({ name: "Старый кашель", severity: 3, startedAt: "2025-01-01T08:00:00.000Z", endedAt: "2025-01-05T08:00:00.000Z" });

    const closed = await request<{ endedAt: string | null }>(`${base}/symptoms/${open.data.id}`, { method: "PATCH", token: alice.accessToken, body: { endedAt: new Date().toISOString() } });
    expect(closed.data.endedAt).not.toBeNull();
    expect((await request(`${base}/symptoms/${open.data.id}`, { method: "PATCH", token: alice.accessToken, body: { endedAt: "2000-01-01T00:00:00.000Z" } })).status).toBe(400);
    const recent = await request<Array<{ name: string }>>(`${base}/symptoms?from=2026-01-01T00:00:00.000Z`, { method: "GET", token: alice.accessToken });
    expect(recent.data.map((x) => x.name)).toEqual(["Головная боль"]);

    // Наполняем остальное, чтобы сводка было что собирать.
    await request(`${base}/medications`, { method: "POST", token: alice.accessToken, body: { name: "Витамин D", dose: "1 капсула", times: ["08:00"] } });
    await request(`${base}/medications`, { method: "POST", token: alice.accessToken, body: { name: "Давно закончил", times: ["08:00"], endOn: "2020-01-01" } });
    await request(`${base}/measurements`, { method: "POST", token: alice.accessToken, body: { kind: "weight", value: 70, measuredAt: "2026-10-01T08:00:00.000Z" } });
    await request(`${base}/measurements`, { method: "POST", token: alice.accessToken, body: { kind: "weight", value: 69.5, measuredAt: "2026-10-10T08:00:00.000Z" } });
    await request(`${base}/measurement-targets/weight`, { method: "PUT", token: alice.accessToken, body: { min: 60, max: 72 } });
    await request(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Терапевт", at: new Date(Date.now() + 5 * 86_400_000).toISOString() } });
    const done = await request<{ id: string }>(`${base}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Окулист", at: "2026-09-01T09:00:00.000Z" } });
    await request(`${base}/appointments/${done.data.id}`, { method: "PATCH", token: alice.accessToken, body: { doneAt: "2026-09-01T10:00:00.000Z", outcome: "ок" } });

    interface Summary {
      subject: { name: string; bloodType: string; allergies: Array<{ substance: string }>; emergencyNote: string };
      medications: Array<{ name: string }>;
      measurements: Array<{ kind: string; latest: { value: number }; recent: unknown[]; target: { min: number; max: number } | null }>;
      upcomingAppointments: Array<{ title: string }>;
      recentAppointments: Array<{ title: string; outcome: string }>;
      symptoms: Array<{ name: string }>;
    }
    const sum = await request<Summary>(`${base}/summary`, { method: "GET", token: alice.accessToken });
    expect(sum.status).toBe(200);
    expect(sum.data.subject).toMatchObject({ name: "Анна", bloodType: "A(II) Rh+", emergencyNote: "Муж: +7 900 000-00-00" });
    expect(sum.data.subject.allergies).toEqual([{ substance: "Арахис", reaction: "сыпь" }]);
    expect(sum.data.medications.map((m) => m.name)).toEqual(["Витамин D"]);
    expect(sum.data.measurements).toHaveLength(1);
    expect(sum.data.measurements[0]).toMatchObject({ kind: "weight", latest: { value: 69.5 }, target: { min: 60, max: 72 } });
    expect(sum.data.measurements[0].recent).toHaveLength(2);
    expect(sum.data.upcomingAppointments.map((a) => a.title)).toEqual(["Терапевт"]);
    expect(sum.data.recentAppointments).toEqual([expect.objectContaining({ title: "Окулист", outcome: "ок" })]);
    expect(sum.data.symptoms.map((x) => x.name)).toEqual(["Головная боль"]);

    // Доступ: без допуска — 404; read видит сводку, но не пишет симптомы; архивное лекарство в сводку не попадает.
    expect((await request(`${base}/summary`, { method: "GET", token: bob.accessToken })).status).toBe(404);
    expect((await request(`${base}/symptoms`, { method: "GET", token: bob.accessToken })).status).toBe(404);
    await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } });
    expect((await request(`${base}/summary`, { method: "GET", token: bob.accessToken })).status).toBe(200);
    expect((await symPost({ name: "x", severity: 1 }, bob.accessToken)).status).toBe(403);
    expect((await request(`${base}/symptoms/${open.data.id}`, { method: "DELETE", token: bob.accessToken })).status).toBe(403);
    expect(await prisma.withUser(bob.user.id, async (tx) => (await tx.healthSymptom.deleteMany({ where: { subjectId: self.data.id } })).count)).toBe(0);

    expect((await request(`${base}/symptoms/${open.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(`${base}/symptoms/${open.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(404);
  });

  it("doctor references preserve create/change/clear and reject a missing replacement atomically", async () => {
    const { alice, ws } = await setup("doctor-crud");
    const subject = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const first = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Первый врач" } });
    const second = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Второй врач" } });
    const base = `${ws}/health/subjects/${subject.data.id}/appointments`;
    const created = await request<{ id: string; doctorContactId: string | null }>(base, { method: "POST", token: alice.accessToken, body: { title: "Визит", at: "2026-11-01T09:00:00Z", doctorContactId: first.data.id } });
    expect(created.status).toBe(201);
    expect(created.data.doctorContactId).toBe(first.data.id);
    const changed = await request<{ doctorContactId: string | null }>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { doctorContactId: second.data.id } });
    expect(changed.status).toBe(200);
    expect(changed.data.doctorContactId).toBe(second.data.id);
    const before = await prisma.asSystem((tx) => tx.healthAppointment.findUniqueOrThrow({ where: { id: created.data.id } }));
    const invalid = await request<{ message: string }>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { title: "Must roll back", doctorContactId: "00000000-0000-4000-8000-000000000000" } });
    expect(invalid.status).toBe(400);
    expect(invalid.data.message).toBe("Контакт не найден в этом пространстве");
    expect(await prisma.asSystem((tx) => tx.healthAppointment.findUniqueOrThrow({ where: { id: created.data.id } }))).toEqual(before);
    const cleared = await request<{ doctorContactId: string | null }>(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { doctorContactId: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.data.doctorContactId).toBeNull();
    expect((await request(`${ws}/contacts/${first.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    expect((await request(base, { method: "POST", token: alice.accessToken, body: { title: "Удалённый врач", at: "2026-11-01T09:00:00Z", doctorContactId: first.data.id } })).status).toBe(400);
  });

  it("rejects a doctor from another workspace even when the caller can read both workspaces", async () => {
    const { alice, bob, ws } = await setup("doctor-two-spaces");
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: bob.workspaceId }, data: { isPersonal: false } }));
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${bob.workspaceId}/invites`, { method: "POST", token: bob.accessToken, body: { email: alice.email } });
    const token = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${token}/accept`, { method: "POST", token: alice.accessToken })).status).toBe(201);
    const contact = await request<{ id: string }>(`/workspaces/${bob.workspaceId}/contacts`, { method: "POST", token: bob.accessToken, body: { name: "Врач другого пространства" } });
    expect(contact.status).toBe(201);
    expect(await prisma.withUser(alice.user.id, (tx) => tx.contact.count({ where: { id: contact.data.id } }))).toBe(1);
    const subject = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    expect((await request(`${ws}/health/subjects/${subject.data.id}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Визит", at: "2026-11-01T09:00:00Z", doctorContactId: contact.data.id } })).status).toBe(400);
  });

  it("archived contacts remain valid references while Contacts CRUD is disabled", async () => {
    const { alice, ws } = await setup("doctor-off");
    const contact = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Архивный врач" } });
    expect((await request(`${ws}/contacts/${contact.data.id}`, { method: "PATCH", token: alice.accessToken, body: { archived: true } })).status).toBe(200);
    expect((await request(`${ws}/modules/contacts`, { method: "PATCH", token: alice.accessToken, body: { enabled: false } })).status).toBe(200);
    expect((await request(`${ws}/contacts`, { method: "GET", token: alice.accessToken })).status).toBe(409);
    const subject = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const visit = await request<{ doctorContactId: string }>(`${ws}/health/subjects/${subject.data.id}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Визит", at: "2026-11-01T09:00:00Z", doctorContactId: contact.data.id } });
    expect(visit.status).toBe(201);
    expect(visit.data.doctorContactId).toBe(contact.data.id);
    expect(await prisma.asSystem((tx) => tx.contact.count({ where: { id: contact.data.id, archivedAt: { not: null } } }))).toBe(1);
  });

  it("the public reader retains RLS and sees uncommitted rows only through the caller's transaction", async () => {
    const { alice, ws } = await setup("doctor-tx");
    const stranger = await register("doctor-tx-stranger");
    const refs = app.get(ContactReferences);
    const contact = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Врач" } });
    expect(await prisma.withUser(stranger.user.id, (tx) => refs.existsTx(tx, alice.workspaceId, contact.data.id))).toBe(false);
    expect(await prisma.withUser(alice.user.id, (tx) => refs.existsTx(tx, alice.workspaceId, contact.data.id))).toBe(true);
    const rollback = new Error("rollback reference transaction");
    let rolledId = "";
    await expect(prisma.withUser(alice.user.id, async (tx) => {
      const pending = await tx.contact.create({ data: { workspaceId: alice.workspaceId, name: "Ещё не сохранён" } });
      rolledId = pending.id;
      expect(await refs.existsTx(tx, alice.workspaceId, pending.id)).toBe(true);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await prisma.asSystem((tx) => tx.contact.count({ where: { id: rolledId } }))).toBe(0);
  });

  it("medical access is checked before consulting the contact reader", async () => {
    const { alice, bob, ws } = await setup("doctor-access");
    const subject = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const contact = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Врач" } });
    const base = `${ws}/health/subjects/${subject.data.id}`;
    const spy = vi.spyOn(app.get(ContactReferences), "existsTx");
    try {
      const body = { title: "Визит", at: "2026-11-01T09:00:00Z", doctorContactId: contact.data.id };
      expect((await request(`${base}/appointments`, { method: "POST", token: bob.accessToken, body })).status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
      await request(`${base}/grants/${bob.user.id}`, { method: "PUT", token: alice.accessToken, body: { level: "read" } });
      expect((await request(`${base}/appointments`, { method: "POST", token: bob.accessToken, body })).status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("Health works with ContactsModule physically absent and only the reference SDK present", async () => {
    const { alice, ws } = await setup("doctor-absent");
    const subject = await request<Subject>(`${ws}/health/subjects`, { method: "POST", token: alice.accessToken, body: { kind: "member", name: "Анна" } });
    const contact = await request<{ id: string }>(`${ws}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "Сохранённый врач" } });
    const host = await NestFactory.create(WithoutContactsApp, { logger: false });
    try {
      configureApp(host);
      await host.listen(0, "127.0.0.1");
      for (const job of host.get(SchedulerRegistry).getCronJobs().values()) job.stop();
      expect(() => host.get(ContactsService)).toThrow();
      const origin = `http://127.0.0.1:${(host.getHttpServer().address() as { port: number }).port}`;
      expect((await request(`${ws}/contacts`, { method: "GET", token: alice.accessToken }, origin)).status).toBe(404);
      const visit = await request<{ doctorContactId: string }>(`${ws}/health/subjects/${subject.data.id}/appointments`, { method: "POST", token: alice.accessToken, body: { title: "Визит", at: "2026-11-01T09:00:00Z", doctorContactId: contact.data.id } }, origin);
      expect(visit.status).toBe(201);
      expect(visit.data.doctorContactId).toBe(contact.data.id);
    } finally { await host.close(); }
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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }, origin = baseUrl): Promise<{ status: number; data: T }> {
    const response = await fetch(`${origin}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
});
