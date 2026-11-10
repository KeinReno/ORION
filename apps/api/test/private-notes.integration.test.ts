import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * G21 (ADR-0021): личные заметки внутри общего пространства. Видит только автор — на уровне БД (RESTRICTIVE-политика),
 * поэтому не помогает ни членство, ни роль владельца пространства; общие заметки видят все.
 */
describe("Private notes in a shared workspace", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const emailPrefix = `private-notes-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
        const ids = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(path: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function pair() {
    const register = async (name: string) => {
      const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", "POST", undefined, {
        email: `${emailPrefix}-${counter++}@example.test`,
        password: "integration-password-123",
        name
      });
      return { token: response.data.accessToken, userId: response.data.user.id, email: `${emailPrefix}-${counter - 1}@example.test` };
    };
    const alice = await register("Алиса");
    const bob = await register("Боб");
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", "GET", alice.token);
    const ws = workspaces.data[0]!.id;
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${ws}/invites`, "POST", alice.token, { email: bob.email });
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, "POST", bob.token)).status).toBe(201);
    return { alice, bob, ws };
  }

  const titles = async (ws: string, token: string, query = "") =>
    (await request<Array<{ title: string; isPrivate?: boolean }>>(`/workspaces/${ws}/notes${query}`, "GET", token)).data.map((n) => n.title).sort();

  it("личную заметку видит только автор, общую — все; владелец пространства чужую личную не видит", async () => {
    const { alice, bob, ws } = await pair();
    const shared = await request(`/workspaces/${ws}/notes`, "POST", alice.token, { title: "Общая", body: "для всех" });
    const mine = await request(`/workspaces/${ws}/notes`, "POST", alice.token, { title: "Личная Алисы", body: "секретное слово ферзь", isPrivate: true });
    const bobs = await request(`/workspaces/${ws}/notes`, "POST", bob.token, { title: "Личная Боба", body: "тайна", isPrivate: true });
    expect([shared.status, mine.status, bobs.status, bobs.data]).toEqual([201, 201, 201, expect.anything()]);
    expect(shared.data.isPrivate).toBe(false);
    expect(mine.data.isPrivate).toBe(true);

    expect(await titles(ws, alice.token)).toEqual(["Личная Алисы", "Общая"]);
    expect(await titles(ws, bob.token)).toEqual(["Личная Боба", "Общая"]);

    // Поиск, автодополнение ссылок и прямые обращения тоже не раскрывают чужое.
    expect(await titles(ws, bob.token, "?search=ферзь")).toEqual([]);
    expect(await titles(ws, alice.token, "?search=ферзь")).toEqual(["Личная Алисы"]);
    const bobTitles = await request<Array<{ title: string }>>(`/workspaces/${ws}/notes/titles`, "GET", bob.token);
    expect(bobTitles.data.map((n) => n.title)).not.toContain("Личная Алисы");
    expect((await request(`/workspaces/${ws}/notes/${mine.data.id}`, "PATCH", bob.token, { body: "взлом" })).status).toBe(404);
    expect((await request(`/workspaces/${ws}/notes/${mine.data.id}`, "DELETE", bob.token)).status).toBe(404);
    expect((await request(`/workspaces/${ws}/notes/${bobs.data.id}`, "PATCH", alice.token, { body: "взлом" })).status).toBe(404);

    // Уровень БД, мимо кода сервиса.
    const seenByBob = await prisma.withUser(bob.userId, (tx) => tx.note.findMany({ where: { workspaceId: ws } }));
    expect(seenByBob.map((n) => n.title).sort()).toEqual(["Личная Боба", "Общая"]);
    await expect(prisma.withUser(bob.userId, (tx) => tx.note.update({ where: { id: mine.data.id }, data: { body: "x" } }))).rejects.toThrow();
    // Нельзя создать заметку, личную для другого пользователя.
    await expect(
      prisma.withUser(bob.userId, (tx) => tx.note.create({ data: { workspaceId: ws, title: "Подброс", privateToUserId: alice.userId } }))
    ).rejects.toThrow();
    // Фоновые задачи (orion_system) видят всё, например чистка корзины.
    expect(await prisma.asSystem((tx) => tx.note.count({ where: { workspaceId: ws } }))).toBe(3);
  });

  it("автор переключает заметку между личной и общей; после этого её видят или перестают видеть остальные", async () => {
    const { alice, bob, ws } = await pair();
    const note = await request(`/workspaces/${ws}/notes`, "POST", alice.token, { title: "Черновик", body: "x", isPrivate: true });
    expect(await titles(ws, bob.token)).toEqual([]);

    const published = await request(`/workspaces/${ws}/notes/${note.data.id}`, "PATCH", alice.token, { isPrivate: false });
    expect(published.status).toBe(200);
    expect(published.data.isPrivate).toBe(false);
    expect(published.data.revision).toBe(2);
    expect(await titles(ws, bob.token)).toEqual(["Черновик"]);

    // Общую заметку личной не сделать — иначе участник мог бы спрятать от остальных чужую запись.
    const hijack = await request(`/workspaces/${ws}/notes/${note.data.id}`, "PATCH", bob.token, { isPrivate: true });
    expect(hijack.status).toBe(409);
    expect(await titles(ws, alice.token)).toEqual(["Черновик"]);

    // Автор может снова сделать собственную заметку личной? Нет — только создать новую личную.
    expect((await request(`/workspaces/${ws}/notes/${note.data.id}`, "PATCH", alice.token, { isPrivate: true })).status).toBe(409);
  });
  it("ревизии, ссылки и вложения личной заметки тоже скрыты от остальных на уровне БД", async () => {
    const { alice, bob, ws } = await pair();
    const note = await request(`/workspaces/${ws}/notes`, "POST", alice.token, { title: "Секрет", body: "ссылка на [[Общая цель]]", isPrivate: true });
    await prisma.asSystem(async (tx) => {
      await tx.noteRevision.create({ data: { workspaceId: ws, noteId: note.data.id, title: "Секрет", summary: "", body: "старый текст секрета", tags: [] } });
    });
    const links = await prisma.withUser(alice.userId, (tx) => tx.noteLink.count({ where: { sourceNoteId: note.data.id } }));
    expect(links).toBe(1);

    const seenByAlice = await prisma.withUser(alice.userId, (tx) => tx.noteRevision.count({ where: { noteId: note.data.id } }));
    expect(seenByAlice).toBe(1);
    expect(await prisma.withUser(bob.userId, (tx) => tx.noteRevision.count({ where: { noteId: note.data.id } }))).toBe(0);
    expect(await prisma.withUser(bob.userId, (tx) => tx.noteLink.count({ where: { sourceNoteId: note.data.id } }))).toBe(0);
    expect(await prisma.withUser(bob.userId, (tx) => tx.noteAttachment.count({ where: { noteId: note.data.id } }))).toBe(0);
    // Подбросить Алисе ревизию от имени Боба нельзя.
    await expect(
      prisma.withUser(bob.userId, (tx) => tx.noteRevision.create({ data: { workspaceId: ws, noteId: note.data.id, title: "x", summary: "", body: "x", tags: [] } }))
    ).rejects.toThrow();

    // После публикации заметка и её история видны всем.
    await request(`/workspaces/${ws}/notes/${note.data.id}`, "PATCH", alice.token, { isPrivate: false });
    expect(await prisma.withUser(bob.userId, (tx) => tx.noteRevision.count({ where: { noteId: note.data.id } }))).toBe(1);
  });
});
