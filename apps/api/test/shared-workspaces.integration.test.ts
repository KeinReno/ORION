import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ModulesContainer } from "@nestjs/core/injector/modules-container";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService } from "../src/sync/snapshot.service";

/**
 * ТЗ-05 §5.1 — сквозной аудит изоляции: «два человека, три пространства».
 *
 *   Reno:    личное R, «Дом» (владелец), «Проекты» (владелец, Варвары там нет)
 *   Варвара: личное V, «Дом» (участник)
 *
 * Для каждого workspace-scoped маршрута человек без членства не получает ни 2xx,
 * ни 5xx; для данных, которые видны только внутри своего пространства (заметки,
 * задачи, поиск, файлы, связи, уведомления, агенты, фид календаря, бэкап),
 * проверяется отсутствие утечки через чужой id и через «своё» пространство.
 * Найденные дыры чинятся отдельными изменениями — этот файл их закрепляет.
 */
describe("ТЗ-05: два пользователя, три пространства", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emailPrefix = `tz05-${runId}`;
  const PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

  type Person = { token: string; userId: string; email: string; personal: string };
  let reno: Person;
  let varvara: Person;
  let home: string;
  let projects: string;

  // Seeded objects, by space.
  const secretR = `СекретРено${runId.replace(/\W/g, "")}`;
  const sharedHome = `ОбщееДом${runId.replace(/\W/g, "")}`;
  const secretV = `СекретВарвары${runId.replace(/\W/g, "")}`;
  const seeded: {
    noteR?: string;
    taskR?: string;
    docR?: string;
    noteHome?: string;
    noteV?: string;
    taskHome?: string;
    projectsNote?: string;
  } = {};

  async function request<T = unknown>(
    path: string,
    options: { method?: string; token?: string; body?: unknown; form?: FormData } = {}
  ): Promise<{ status: number; data: T; text: string; headers: Headers }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.form ? {} : { "Content-Type": "application/json" }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: response.status, data: data as T, text, headers: response.headers };
  }

  async function register(name: string): Promise<Person> {
    const email = `${emailPrefix}-${name}@example.test`;
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const spaces = await request<Array<{ id: string; isPersonal: boolean }>>("/workspaces/me", { token });
    expect(spaces.data).toHaveLength(1);
    expect(spaces.data[0]!.isPersonal).toBe(true);
    return { token, userId: registered.data.user.id, email, personal: spaces.data[0]!.id };
  }

  /** Владелец приглашает по email, гость принимает: полный путь через HTTP. */
  async function invite(owner: Person, workspaceId: string, guest: Person, role: "member" | "lead" = "member"): Promise<void> {
    const created = await request<{ acceptUrl: string; code: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: owner.token,
      body: { email: guest.email, role }
    });
    expect(created.status).toBe(201);
    const token = new URL(created.data.acceptUrl).searchParams.get("token")!;
    expect(created.data.code).toBe(token);
    const accepted = await request(`/invites/${token}/accept`, { method: "POST", token: guest.token });
    expect(accepted.status).toBe(201);
  }

  async function memberRow(workspaceId: string, userId: string) {
    return prisma.asSystem((tx) => tx.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId } } }));
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);

    reno = await register("reno");
    varvara = await register("varvara");

    const createdHome = await request<{ id: string; isPersonal: boolean; disabledModules: string[] }>("/workspaces", {
      method: "POST",
      token: reno.token,
      body: { name: "Дом", template: "home" }
    });
    expect(createdHome.status).toBe(201);
    expect(createdHome.data.isPersonal).toBe(false);
    home = createdHome.data.id;
    const createdProjects = await request<{ id: string }>("/workspaces", { method: "POST", token: reno.token, body: { name: "Проекты" } });
    projects = createdProjects.data.id;
    await invite(reno, home, varvara);

    // Seed through the real HTTP surface where it is cheap, so the data really is reachable by the code under test.
    const noteR = await request<{ id: string }>(`/workspaces/${reno.personal}/notes`, { method: "POST", token: reno.token, body: { title: secretR, body: `тело ${secretR}` } });
    expect(noteR.status).toBe(201);
    seeded.noteR = noteR.data.id;
    const taskR = await request<{ id: string }>(`/workspaces/${reno.personal}/tasks`, { method: "POST", token: reno.token, body: { title: secretR } });
    expect(taskR.status).toBe(201);
    seeded.taskR = taskR.data.id;
    const noteHome = await request<{ id: string }>(`/workspaces/${home}/notes`, { method: "POST", token: reno.token, body: { title: sharedHome, body: "общее" } });
    // «Дом» держит заметки выключенными — включаем, чтобы проверить общий контент.
    if (noteHome.status !== 201) {
      await prisma.asSystem((tx) => tx.workspace.update({ where: { id: home }, data: { disabledModules: ["markets", "health"] } }));
      const retry = await request<{ id: string }>(`/workspaces/${home}/notes`, { method: "POST", token: reno.token, body: { title: sharedHome, body: "общее" } });
      expect(retry.status).toBe(201);
      seeded.noteHome = retry.data.id;
    } else {
      seeded.noteHome = noteHome.data.id;
    }
    const taskHome = await request<{ id: string }>(`/workspaces/${home}/tasks`, { method: "POST", token: reno.token, body: { title: sharedHome } });
    expect(taskHome.status).toBe(201);
    seeded.taskHome = taskHome.data.id;
    const noteV = await request<{ id: string }>(`/workspaces/${varvara.personal}/notes`, { method: "POST", token: varvara.token, body: { title: secretV, body: secretV } });
    expect(noteV.status).toBe(201);
    seeded.noteV = noteV.data.id;
    const noteP = await request<{ id: string }>(`/workspaces/${projects}/notes`, { method: "POST", token: reno.token, body: { title: `Проект ${secretR}`, body: "x" } });
    expect(noteP.status).toBe(201);
    seeded.projectsNote = noteP.data.id;

    const form = new FormData();
    form.append("files", new Blob([`байты ${secretR}`], { type: "text/plain" }), `файл-${runId}.txt`);
    const uploaded = await request<Array<{ id: string }>>(`/workspaces/${reno.personal}/documents/upload`, { method: "POST", token: reno.token, form });
    expect(uploaded.status).toBe(201);
    seeded.docR = uploaded.data[0]!.id;
  }, 120_000);

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
  }, 60_000);

  // --- 5.1: свип по всем маршрутам -------------------------------------------------

  /** Все маршруты `.../:workspaceId/...` из реальных контроллеров Nest — новый модуль попадёт в аудит сам. */
  function workspaceRoutes(): Array<{ method: string; path: string }> {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    const routes: Array<{ method: string; path: string }> = [];
    const container = app.get(ModulesContainer);
    for (const moduleRef of container.values()) {
      for (const wrapper of moduleRef.controllers.values()) {
        const ctor = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (!ctor?.prototype) continue;
        const base = (Reflect.getMetadata("path", ctor) as string | string[] | undefined) ?? "";
        const basePath = Array.isArray(base) ? base[0]! : base;
        for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
          if (name === "constructor") continue;
          const handler = (ctor.prototype as Record<string, unknown>)[name];
          if (typeof handler !== "function") continue;
          const methodIndex = Reflect.getMetadata("method", handler) as number | undefined;
          if (methodIndex === undefined) continue;
          const sub = (Reflect.getMetadata("path", handler) as string | string[] | undefined) ?? "";
          const subPath = Array.isArray(sub) ? sub[0]! : sub;
          const full = `/${[basePath, subPath].filter((s) => s && s !== "/").join("/")}`.replace(/\/+/g, "/");
          if (full.includes(":workspaceId")) routes.push({ method: methods[methodIndex] ?? "GET", path: full });
        }
      }
    }
    return routes;
  }

  function fill(path: string, workspaceId: string): string {
    return path
      .replace(":workspaceId", workspaceId)
      .replace(/:[A-Za-z]+(\.[a-z]+)?/g, PLACEHOLDER)
      .replace(/\*/g, "x");
  }

  it("находит достаточно маршрутов, чтобы свип что-то значил", () => {
    const routes = workspaceRoutes();
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.some((r) => r.path.startsWith("/workspaces/:workspaceId/notes"))).toBe(true);
    expect(routes.some((r) => r.path.includes("/documents/:id/content"))).toBe(true);
    expect(routes.some((r) => r.path.includes("/sync/backup"))).toBe(true);
  });

  const OUTSIDER_OK = new Set([400, 401, 403, 404, 405, 409, 415, 422]);

  async function sweep(token: string, workspaceId: string): Promise<string[]> {
    const bad: string[] = [];
    for (const route of workspaceRoutes()) {
      const url = fill(route.path, workspaceId);
      const hasBody = route.method !== "GET" && route.method !== "DELETE";
      const response = await request(url, { method: route.method, token, body: hasBody ? {} : undefined });
      if (!OUTSIDER_OK.has(response.status)) bad.push(`${route.method} ${route.path} → ${response.status}`);
    }
    return bad;
  }

  it("Варвара не получает ни 2xx, ни 5xx ни на одном маршруте личного пространства Reno", async () => {
    expect(await sweep(varvara.token, reno.personal)).toEqual([]);
  }, 180_000);

  it("Варвара не получает ничего на маршрутах «Проектов», куда её не приглашали", async () => {
    expect(await sweep(varvara.token, projects)).toEqual([]);
  }, 180_000);

  it("Reno не получает ничего на маршрутах личного пространства Варвары", async () => {
    expect(await sweep(reno.token, varvara.personal)).toEqual([]);
  }, 180_000);

  it("контрольная группа: участнику «Дома» GET-маршруты отвечают (свип не вырожден)", async () => {
    let ok = 0;
    for (const route of workspaceRoutes().filter((r) => r.method === "GET" && !/:[A-Za-z]+/.test(r.path.replace(":workspaceId", "")))) {
      const response = await request(fill(route.path, home), { token: varvara.token });
      if (response.status === 200) ok += 1;
      expect(response.status, `${route.path}`).toBeLessThan(500);
    }
    expect(ok).toBeGreaterThan(15);
  }, 120_000);

  // --- 5.1: данные --------------------------------------------------------------

  it("заметки/задачи: чужая запись не читается ни через своё, ни через чужое пространство", async () => {
    // Через чужое пространство — 403.
    expect((await request(`/workspaces/${reno.personal}/notes/${seeded.noteR}`, { token: varvara.token })).status).toBe(403);
    // Через «своё» пространство с чужим id — 404, а не данные (RLS + проверка workspaceId).
    expect((await request(`/workspaces/${home}/notes/${seeded.noteR}`, { token: varvara.token })).status).toBe(404);
    expect((await request(`/workspaces/${varvara.personal}/notes/${seeded.noteR}`, { token: varvara.token })).status).toBe(404);
    expect((await request(`/workspaces/${home}/tasks/${seeded.taskR}`, { token: varvara.token })).status).toBeGreaterThanOrEqual(400);
    // Записать поверх чужого — тоже нет.
    const patch = await request(`/workspaces/${home}/notes/${seeded.noteR}`, { method: "PATCH", token: varvara.token, body: { title: "взлом" } });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const note = await prisma.asSystem((tx) => tx.note.findUniqueOrThrow({ where: { id: seeded.noteR! } }));
    expect(note.title).toBe(secretR);
    // Списки «Дома» не содержат чужого.
    const list = await request<Array<{ title: string }>>(`/workspaces/${home}/notes`, { token: varvara.token });
    expect(list.status).toBe(200);
    expect(list.data.map((n) => n.title)).toContain(sharedHome);
    expect(JSON.stringify(list.data)).not.toContain(secretR);
  });

  it("общий «Дом»: оба видят одно и то же, личное — только владелец", async () => {
    const renoTasks = await request<Array<{ title: string }>>(`/workspaces/${home}/tasks`, { token: reno.token });
    const varvaraTasks = await request<Array<{ title: string }>>(`/workspaces/${home}/tasks`, { token: varvara.token });
    expect(renoTasks.data.map((t) => t.title)).toContain(sharedHome);
    expect(varvaraTasks.data.map((t) => t.title)).toContain(sharedHome);
    expect(JSON.stringify(varvaraTasks.data)).not.toContain(secretR);
    // Личное Варвары невидимо Reno даже как владельцу «Дома».
    expect((await request(`/workspaces/${varvara.personal}/notes`, { token: reno.token })).status).toBe(403);
    expect((await request(`/workspaces/${varvara.personal}/notes/${seeded.noteV}`, { token: reno.token })).status).toBe(403);
    expect((await request(`/workspaces/${home}/notes/${seeded.noteV}`, { token: reno.token })).status).toBe(404);
  });

  it("поиск: находит общее, не находит чужое — ни в своём, ни в чужом пространстве", async () => {
    const own = await request<Array<{ id: string; title: string }>>(`/workspaces/${home}/search?q=${encodeURIComponent(sharedHome)}`, { token: varvara.token });
    expect(own.status).toBe(200);
    expect(own.data.length).toBeGreaterThan(0);
    const leak = await request<Array<{ id: string }>>(`/workspaces/${home}/search?q=${encodeURIComponent(secretR)}`, { token: varvara.token });
    expect(leak.status).toBe(200);
    expect(leak.data).toEqual([]);
    expect((await request(`/workspaces/${reno.personal}/search?q=${encodeURIComponent(secretR)}`, { token: varvara.token })).status).toBe(403);
    // Reno ищет в «Доме» то, что лежит в его личном, — «Дом» этого не знает.
    const renoInHome = await request<Array<{ id: string }>>(`/workspaces/${home}/search?q=${encodeURIComponent(secretR)}`, { token: reno.token });
    expect(renoInHome.data).toEqual([]);
  });

  it("документы: поток содержимого чужого файла недоступен ни напрямую, ни по id в своём пространстве", async () => {
    const own = await request(`/workspaces/${reno.personal}/documents/${seeded.docR}/content`, { token: reno.token });
    expect(own.status).toBe(200);
    expect(own.text).toContain(secretR);
    for (const space of [reno.personal, home, varvara.personal]) {
      const stolen = await request(`/workspaces/${space}/documents/${seeded.docR}/content`, { token: varvara.token });
      expect(stolen.status, `через ${space}`).toBeGreaterThanOrEqual(400);
      expect(stolen.text).not.toContain(secretR);
    }
    for (const suffix of ["versions", "content?disposition=attachment"]) {
      const response = await request(`/workspaces/${home}/documents/${seeded.docR}/${suffix}`, { token: varvara.token });
      expect(response.text).not.toContain(secretR);
    }
    // Без токена — тоже нет.
    expect((await request(`/workspaces/${reno.personal}/documents/${seeded.docR}/content`)).status).toBe(401);
  });

  it("связи: EntityLink на объект чужого пространства не создаётся ни с одной стороны", async () => {
    const cross = await request(`/workspaces/${home}/links`, {
      method: "POST",
      token: reno.token,
      body: { sourceType: "note", sourceId: seeded.noteHome, targetType: "task", targetId: seeded.taskR }
    });
    expect(cross.status, cross.text).toBe(404);
    const reverse = await request(`/workspaces/${reno.personal}/links`, {
      method: "POST",
      token: reno.token,
      body: { sourceType: "note", sourceId: seeded.noteR, targetType: "task", targetId: seeded.taskHome }
    });
    expect(reverse.status, reverse.text).toBe(404);
    // Варвара не может связать свой объект с чужим, даже зная id.
    const byVarvara = await request(`/workspaces/${home}/links`, {
      method: "POST",
      token: varvara.token,
      body: { sourceType: "note", sourceId: seeded.noteHome, targetType: "task", targetId: seeded.taskR }
    });
    expect(byVarvara.status, byVarvara.text).toBe(404);
    // Допустимая связь внутри «Дома» работает — а читать её чужому нельзя.
    const ok = await request<{ id: string }>(`/workspaces/${home}/links`, {
      method: "POST",
      token: varvara.token,
      body: { sourceType: "note", sourceId: seeded.noteHome, targetType: "task", targetId: seeded.taskHome }
    });
    expect(ok.status).toBe(201);
    const read = await request(`/workspaces/${reno.personal}/links?type=note&id=${seeded.noteHome}`, { token: varvara.token });
    expect(read.status).toBe(403);
    const viaOther = await request(`/workspaces/${home}/links?type=note&id=${seeded.noteR}`, { token: varvara.token });
    expect(viaOther.status).toBe(404);
    const count = await prisma.asSystem((tx) => tx.entityLink.count({ where: { OR: [{ sourceId: { in: [seeded.noteR!, seeded.taskR!] } }, { targetId: { in: [seeded.noteR!, seeded.taskR!] } }] } }));
    expect(count).toBe(0);
  });

  it("уведомления и входящие: адресное видно только адресату; чужое пространство закрыто", async () => {
    await prisma.asSystem((tx) =>
      tx.notification.createMany({
        data: [
          { workspaceId: home, recipientId: reno.userId, kind: "task_due", title: `Для Reno ${runId}` },
          { workspaceId: home, recipientId: varvara.userId, kind: "task_due", title: `Для Варвары ${runId}` }
        ]
      })
    );
    const mine = await request<{ items?: Array<{ title: string }> } | Array<{ title: string }>>(`/workspaces/${home}/notifications`, { token: varvara.token });
    expect(mine.status).toBe(200);
    const text = JSON.stringify(mine.data);
    expect(text).toContain(`Для Варвары ${runId}`);
    expect(text).not.toContain(`Для Reno ${runId}`);
    expect((await request(`/workspaces/${reno.personal}/notifications`, { token: varvara.token })).status).toBe(403);

    const item = await request<{ id: string }>(`/workspaces/${reno.personal}/inbox`, { method: "POST", token: reno.token, body: { title: `Входящее ${secretR}` } });
    expect(item.status).toBe(201);
    expect((await request(`/workspaces/${reno.personal}/inbox`, { token: varvara.token })).status).toBe(403);
    const inHome = await request(`/workspaces/${home}/inbox`, { token: varvara.token });
    expect(inHome.text).not.toContain(secretR);
    expect((await request(`/workspaces/${home}/inbox/${item.data.id}`, { method: "DELETE", token: varvara.token })).status).toBeGreaterThanOrEqual(400);
  });

  it("агенты: токен привязан к пространству и человеку; ушедший из «Дома» теряет и токены", async () => {
    const made = await request<{ secret: string; id: string }>(`/workspaces/${home}/agent-tokens`, {
      method: "POST",
      token: varvara.token,
      body: { name: "Агент Варвары", scopes: ["tasks:read", "notes:read"], expiresInDays: 30 }
    });
    expect(made.status).toBe(201);
    const agent = made.data.secret;

    const me = await request<{ workspaceId: string }>("/ai/v1/me", { token: agent });
    expect(me.status).toBe(200);
    expect(me.data.workspaceId).toBe(home);
    const seen = await request("/ai/v1/notes", { token: agent });
    expect(seen.status).toBe(200);
    expect(seen.text).toContain(sharedHome);
    expect(seen.text).not.toContain(secretR);
    expect(seen.text).not.toContain(secretV); // даже собственное личное пространство человека агенту «Дома» не принадлежит
    // Токен пользовательский JWT не заменяет и наоборот.
    expect((await request("/ai/v1/me", { token: varvara.token })).status).toBe(401);
    expect((await request(`/workspaces/${home}/tasks`, { token: agent })).status).toBe(401);

    // Reno не видит чужие токены и не может отозвать их по id.
    const renoList = await request<Array<{ id: string }>>(`/workspaces/${home}/agent-tokens`, { token: reno.token });
    expect(renoList.data.map((t) => t.id)).not.toContain(made.data.id);
    expect((await request(`/workspaces/${home}/agent-tokens/${made.data.id}`, { method: "DELETE", token: reno.token })).status).toBe(404);
    expect((await request("/ai/v1/me", { token: agent })).status).toBe(200);

    // Журнал агентов: посторонний его не видит; участник — только действия своих токенов, владелец — все.
    const ownerAudit = await request<Array<{ tokenName: string }>>(`/workspaces/${home}/agent-tokens/audit`, { token: reno.token });
    expect(ownerAudit.status).toBe(200);
    expect(ownerAudit.data.some((e) => e.tokenName === "Агент Варвары")).toBe(true);
    const renoAgent = await request<{ secret: string }>(`/workspaces/${home}/agent-tokens`, {
      method: "POST",
      token: reno.token,
      body: { name: "Агент Reno", scopes: ["tasks:read"], expiresInDays: 30 }
    });
    expect((await request("/ai/v1/tasks", { token: renoAgent.data.secret })).status).toBe(200);
    const memberAudit = await request<Array<{ tokenName: string }>>(`/workspaces/${home}/agent-tokens/audit`, { token: varvara.token });
    expect(memberAudit.status).toBe(200);
    expect(memberAudit.data.some((e) => e.tokenName === "Агент Reno")).toBe(false);
    expect(memberAudit.data.some((e) => e.tokenName === "Агент Варвары")).toBe(true);
    expect((await request(`/workspaces/${reno.personal}/agent-tokens/audit`, { token: varvara.token })).status).toBe(403);

    // Владелец убирает Варвару из «Дома» — токен умирает сразу, не по сроку.
    const row = await memberRow(home, varvara.userId);
    expect((await request(`/workspaces/${home}/members/${row.id}`, { method: "DELETE", token: reno.token })).status).toBeLessThan(300);
    expect((await request("/ai/v1/me", { token: agent })).status).toBe(401);
    expect((await request("/ai/v1/notes", { token: agent })).status).toBe(401);
    expect((await request(`/workspaces/${home}/notes`, { token: varvara.token })).status).toBe(403);
    // ...и возвращается обратно приглашением, как новый участник.
    await invite(reno, home, varvara);
    expect((await request(`/workspaces/${home}/notes`, { token: varvara.token })).status).toBe(200);
    expect((await request("/ai/v1/me", { token: agent })).status).toBe(401);
  });

  it("календарь: фид по токену отдаёт только своё пространство; токен соседа и ротация", async () => {
    await prisma.asSystem((tx) =>
      tx.event.create({
        data: { workspaceId: reno.personal, title: `Событие ${secretR}`, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000) }
      })
    );
    await prisma.asSystem((tx) =>
      tx.event.create({
        data: { workspaceId: home, title: `Событие ${sharedHome}`, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000) }
      })
    );
    const renoFeed = await request<{ token: string }>(`/workspaces/${reno.personal}/calendar/feed`, { token: reno.token });
    const homeFeed = await request<{ token: string }>(`/workspaces/${home}/calendar/feed`, { token: varvara.token });
    expect(renoFeed.status).toBe(200);
    expect(homeFeed.status).toBe(200);
    expect(renoFeed.data.token).not.toBe(homeFeed.data.token);

    // Варвара не может получить токен чужого фида — ни прочитать, ни перевыпустить.
    expect((await request(`/workspaces/${reno.personal}/calendar/feed`, { token: varvara.token })).status).toBe(403);
    expect((await request(`/workspaces/${reno.personal}/calendar/feed/rotate`, { method: "POST", token: varvara.token })).status).toBe(403);

    const homeIcs = await request(`/calendar/${homeFeed.data.token}.ics`);
    expect(homeIcs.status).toBe(200);
    expect(homeIcs.text).toContain(sharedHome);
    expect(homeIcs.text).not.toContain(secretR);
    const renoIcs = await request(`/calendar/${renoFeed.data.token}.ics`);
    expect(renoIcs.text).toContain(secretR);
    expect(renoIcs.text).not.toContain(sharedHome);
    expect((await request(`/calendar/${"x".repeat(32)}.ics`)).status).toBe(404);

    // После ротации старая ссылка мертва.
    const rotated = await request<{ token: string }>(`/workspaces/${home}/calendar/feed/rotate`, { method: "POST", token: reno.token });
    expect(rotated.status).toBeLessThan(300);
    expect((await request(`/calendar/${homeFeed.data.token}.ics`)).status).toBe(404);
    expect((await request(`/calendar/${rotated.data.token}.ics`)).status).toBe(200);
  });

  it("бэкап: участник «Дома» и посторонний не видят ни настройки, ни копии; только владелец", async () => {
    for (const person of [varvara, reno]) {
      const target = person === varvara ? reno.personal : varvara.personal;
      for (const [method, path] of [
        ["GET", "sync/remote"],
        ["PUT", "sync/remote"],
        ["POST", "sync/backup"],
        ["GET", "sync/backups"],
        ["POST", "sync/restore"]
      ] as const) {
        const response = await request(`/workspaces/${target}/${path}`, { method, token: person.token, body: method === "GET" ? undefined : {} });
        expect(response.status, `${person === varvara ? "Варвара" : "Reno"} ${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
    }
    // Участник того же пространства — тоже нет (owner-only).
    for (const [method, path] of [
      ["GET", "sync/remote"],
      ["POST", "sync/backup"],
      ["GET", "sync/backups"],
      ["POST", "sync/restore"]
    ] as const) {
      const response = await request(`/workspaces/${home}/${path}`, { method, token: varvara.token, body: method === "GET" ? undefined : { dryRun: true } });
      expect(response.status, `участник ${method} ${path}`).toBe(403);
    }
    // Владелец — доходит до бизнес-логики («удалёнка не настроена»), а не до 403.
    const owner = await request(`/workspaces/${home}/sync/backup`, { method: "POST", token: reno.token, body: {} });
    expect(owner.status).toBe(404);
  });

  it("снимок пространства содержит строки только этого пространства", async () => {
    const snapshots = app.get(SnapshotService);
    for (const workspaceId of [home, reno.personal, varvara.personal, projects]) {
      const snapshot = await prisma.withUser(
        // Читаем от имени владельца пространства.
        workspaceId === varvara.personal ? varvara.userId : reno.userId,
        (tx) => snapshots.serialize(tx, workspaceId)
      );
      expect(snapshot.workspaceId).toBe(workspaceId);
      const foreign: string[] = [];
      for (const [table, rows] of Object.entries(snapshot.tables)) {
        for (const row of rows as Array<{ workspaceId?: string; id?: string }>) {
          if (row.workspaceId !== workspaceId) foreign.push(`${table}:${row.id}`);
        }
      }
      expect(foreign).toEqual([]);
    }
    const homeSnapshot = await prisma.withUser(reno.userId, (tx) => snapshots.serialize(tx, home));
    expect(JSON.stringify(homeSnapshot)).not.toContain(secretR);
    expect(JSON.stringify(homeSnapshot)).not.toContain(secretV);
  });

  it("Варвара в «Доме» не видит «Проекты» и не может в них войти без приглашения", async () => {
    const mine = await request<Array<{ id: string }>>("/workspaces/me", { token: varvara.token });
    expect(mine.data.map((w) => w.id).sort()).toEqual([home, varvara.personal].sort());
    expect((await request(`/workspaces/${projects}/notes`, { token: varvara.token })).status).toBe(403);
    expect((await request(`/workspaces/${projects}/members`, { token: varvara.token })).status).toBe(403);
    expect((await request(`/workspaces/${projects}/invites`, { token: varvara.token })).status).toBe(403);
    // Участники «Дома» видят только участников «Дома».
    const homeMembers = await request<Array<{ userId: string }>>(`/workspaces/${home}/members`, { token: varvara.token });
    expect(homeMembers.data.map((m) => m.userId).sort()).toEqual([reno.userId, varvara.userId].sort());
    // Сама Варвара не может выдать себе доступ: нет ни приглашения, ни повышения.
    const forged = await request(`/workspaces/${projects}/invites`, { method: "POST", token: varvara.token, body: { email: varvara.email } });
    expect(forged.status).toBe(403);
    const me = await memberRow(home, varvara.userId);
    expect((await request(`/workspaces/${home}/members/${me.id}`, { method: "PATCH", token: varvara.token, body: { role: "owner" } })).status).toBe(403);
    expect((await memberRow(home, varvara.userId)).role).toBe("member");
  });

  it("финансы «по назначенной роли»: ограничение модуля закрывает участника, лид и владелец проходят", async () => {
    const base = `/workspaces/${home}/finance/accounts`;
    // Включаем финансы в «Доме» (по шаблону они выключены).
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: home }, data: { disabledModules: ["markets", "health"] } }));
    expect((await request(base, { token: varvara.token })).status).toBe(200);
    const modulesPath = `/workspaces/${home}/modules`;
    const restricted = await request(`${modulesPath}/finance/restricted`, { method: "PUT", token: reno.token, body: { restricted: true } });
    // Путь управления может называться иначе — проверяем напрямую состоянием, если ручка другая.
    if (restricted.status >= 400) {
      await prisma.asSystem((tx) => tx.workspace.update({ where: { id: home }, data: { restrictedModules: ["finance"] } }));
    }
    expect((await request(base, { token: varvara.token })).status).toBe(403);
    expect((await request(base, { token: reno.token })).status).toBe(200);
    // Назначили лидом — получила доступ.
    const row = await memberRow(home, varvara.userId);
    expect((await request(`/workspaces/${home}/members/${row.id}`, { method: "PATCH", token: reno.token, body: { role: "lead" } })).status).toBe(200);
    expect((await request(base, { token: varvara.token })).status).toBe(200);
    // Возвращаем как было.
    await request(`/workspaces/${home}/members/${row.id}`, { method: "PATCH", token: reno.token, body: { role: "member" } });
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: home }, data: { restrictedModules: [] } }));
  });

  // --- 5.2: приглашения --------------------------------------------------------------

  it("приглашения: роль выбирается, лид назначается только владельцем, статусы pending/used/revoked/expired", async () => {
    const guest = await register("guest-roles");
    const lead = await register("lead");
    await invite(reno, home, lead, "lead");
    expect((await memberRow(home, lead.userId)).role).toBe("lead");

    // Лид приглашает участника, но не лида.
    const asLead = await request(`/workspaces/${home}/invites`, { method: "POST", token: lead.token, body: { email: guest.email, role: "lead" } });
    expect(asLead.status).toBe(403);
    const created = await request<{ id: string; acceptUrl: string; code: string; role: string }>(`/workspaces/${home}/invites`, {
      method: "POST",
      token: lead.token,
      body: { email: guest.email }
    });
    expect(created.status).toBe(201);
    expect(created.data.role).toBe("member");
    const token = created.data.code;

    // Дубликат ожидающего приглашения отклоняется.
    expect((await request(`/workspaces/${home}/invites`, { method: "POST", token: reno.token, body: { email: guest.email } })).status).toBe(400);
    // Нельзя пригласить «владельцем» — роль приглашения ограничена.
    expect((await request(`/workspaces/${home}/invites`, { method: "POST", token: reno.token, body: { email: `x-${guest.email}`, role: "owner" } })).status).toBe(400);

    // Чужой email принять не может.
    expect((await request(`/invites/${token}/accept`, { method: "POST", token: varvara.token })).status).toBe(403);
    expect((await request<{ status: string }>(`/invites/${token}`)).data.status).toBe("pending");

    // Отзыв делает код недействительным.
    expect((await request(`/workspaces/${home}/invites/${created.data.id}`, { method: "DELETE", token: reno.token })).status).toBeLessThan(300);
    expect((await request<{ status: string }>(`/invites/${token}`)).data.status).toBe("revoked");
    expect((await request(`/invites/${token}/accept`, { method: "POST", token: guest.token })).status).toBe(400);

    // Просроченное — expired и не принимается.
    const second = await request<{ id: string; code: string }>(`/workspaces/${home}/invites`, { method: "POST", token: reno.token, body: { email: guest.email } });
    await prisma.asSystem((tx) => tx.workspaceInvite.update({ where: { id: second.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    expect((await request<{ status: string }>(`/invites/${second.data.code}`)).data.status).toBe("expired");
    expect((await request(`/invites/${second.data.code}/accept`, { method: "POST", token: guest.token })).status).toBe(400);

    // Принятое — used, повторно не принять; роль берётся из приглашения.
    const third = await request<{ code: string }>(`/workspaces/${home}/invites`, { method: "POST", token: reno.token, body: { email: guest.email, role: "lead" } });
    expect(third.status).toBe(201);
    expect((await request(`/invites/${third.data.code}/accept`, { method: "POST", token: guest.token })).status).toBe(201);
    expect((await memberRow(home, guest.userId)).role).toBe("lead");
    expect((await request<{ status: string }>(`/invites/${third.data.code}`)).data.status).toBe("used");
    expect((await request(`/invites/${third.data.code}/accept`, { method: "POST", token: guest.token })).status).toBe(400);

    // Смена роли — только владелец; лид не может понизить/повысить.
    const guestRow = await memberRow(home, guest.userId);
    expect((await request(`/workspaces/${home}/members/${guestRow.id}`, { method: "PATCH", token: lead.token, body: { role: "member" } })).status).toBe(403);
    expect((await request(`/workspaces/${home}/members/${guestRow.id}`, { method: "PATCH", token: reno.token, body: { role: "member" } })).status).toBe(200);
  });

  // --- 5.4: личные пространства -------------------------------------------------

  it("личное пространство: создаётся при регистрации, помечено личным, владелец «Дома» его не получает", async () => {
    const personalRows = await prisma.asSystem((tx) => tx.workspace.findMany({ where: { id: { in: [reno.personal, varvara.personal] } } }));
    expect(personalRows.every((w) => w.isPersonal)).toBe(true);
    expect(personalRows.every((w) => w.name.endsWith("личное пространство"))).toBe(true);
    // Не предлагается как общее: интерфейс прячет приглашения для isPersonal (флаг приходит в DTO пространства).
    // Сервер сознательно не запрещает владельцу открыть своё личное пространство вручную — это его решение.
    const dto = await request<Array<{ id: string; isPersonal: boolean }>>("/workspaces/me", { token: varvara.token });
    expect(dto.data.find((w) => w.id === varvara.personal)?.isPersonal).toBe(true);
    expect(dto.data.find((w) => w.id === home)?.isPersonal).toBe(false);
    // «Дом» и «Проекты» — не личные.
    const shared = await prisma.asSystem((tx) => tx.workspace.findMany({ where: { id: { in: [home, projects] } } }));
    expect(shared.every((w) => !w.isPersonal)).toBe(true);
    // Reno не видит личное Варвары ни в списке пространств, ни в списке участников чужого пространства.
    const renoSpaces = await request<Array<{ id: string }>>("/workspaces/me", { token: reno.token });
    expect(renoSpaces.data.map((w) => w.id)).not.toContain(varvara.personal);
    expect((await request(`/workspaces/${varvara.personal}/members`, { token: reno.token })).status).toBe(403);
    // Единственный участник личного пространства — его владелец.
    const members = await prisma.asSystem((tx) => tx.workspaceMember.findMany({ where: { workspaceId: varvara.personal } }));
    expect(members.map((m) => m.userId)).toEqual([varvara.userId]);
    // Удалить чужое пространство нельзя.
    expect((await request(`/workspaces/${varvara.personal}`, { method: "DELETE", token: reno.token })).status).toBe(403);
    expect((await request(`/workspaces/${home}`, { method: "DELETE", token: varvara.token })).status).toBe(403);
  });

  it("шаблон «Дом»: модули по ТЗ, финансы выключены, данные не удаляются", async () => {
    const created = await request<{ id: string; disabledModules: string[] }>("/workspaces", { method: "POST", token: reno.token, body: { name: `Дом-2 ${runId}`, template: "home" } });
    expect(created.status).toBe(201);
    const disabled = new Set(created.data.disabledModules);
    for (const enabled of ["lists", "tasks", "calendar", "home", "inventory"]) expect(disabled.has(enabled), enabled).toBe(false);
    expect(disabled.has("finance")).toBe(true);
    expect((await request(`/workspaces/${created.data.id}/lists`, { token: reno.token })).status).toBe(200);
    expect((await request(`/workspaces/${created.data.id}/finance/accounts`, { token: reno.token })).status).toBe(409);
  });
});
