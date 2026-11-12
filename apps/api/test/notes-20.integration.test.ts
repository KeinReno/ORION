import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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

interface NoteResponse {
  id: string;
  title: string;
  body: string;
  number: number | null;
  revision: number;
}

interface RevisionSummary {
  id: string;
  title: string;
  createdAt: string;
  restoredFrom: string | null;
}

interface RevisionDiff {
  fromRevisionId: string;
  toRevisionId: string | null;
  lines: Array<{ type: string; text: string; oldLine: number | null; newLine: number | null }>;
  added: number;
  removed: number;
}

interface NoteLinks {
  outgoing: Array<{ id: string; title: string; noteId: string | null; broken: boolean }>;
  incoming: Array<{ id: string; title: string; noteId: string | null; broken: boolean }>;
}

/**
 * 07 — Заметки 2.0 (backend). Проверяем приёмку задания на реальной
 * PostgreSQL/RLS: версии (restore + diff), wiki-ссылки с broken, поиск
 * внутри заметки, связанные заметки и per-user состояние стопок.
 */
describe("Notes 2.0", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let alice: RegisteredSession;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `notes20-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    alice = await register("alice");
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

  it("restore версии создаёт новую ревизию с restoredFrom и сохраняет историю", async () => {
    const note = await createNote("Версии", "строка 1\nстрока 2");
    const updated = await request<NoteResponse>(notePath(note.id), {
      method: "PATCH",
      token: alice.accessToken,
      body: { body: "строка 1\nстрока 2 изменена", expectedRevision: note.revision }
    });
    expect(updated.status).toBe(200);

    const revisions = await request<RevisionSummary[]>(notePath(note.id) + "/revisions", {
      method: "GET",
      token: alice.accessToken
    });
    expect(revisions.status).toBe(200);
    expect(revisions.data.length).toBeGreaterThanOrEqual(1);
    const beforeEdit = revisions.data[0];
    expect(beforeEdit.restoredFrom).toBeNull();

    const restored = await request<NoteResponse>(notePath(note.id) + `/revisions/${beforeEdit.id}/restore`, {
      method: "POST",
      token: alice.accessToken,
      body: {}
    });
    expect(restored.status).toBe(201);
    expect(restored.data.body).toBe("строка 1\nстрока 2");

    const afterRestore = await request<RevisionSummary[]>(notePath(note.id) + "/revisions", {
      method: "GET",
      token: alice.accessToken
    });
    expect(afterRestore.status).toBe(200);
    const marker = afterRestore.data.find((revision) => revision.restoredFrom === beforeEdit.id);
    expect(marker).toBeDefined();
    expect(marker?.id).not.toBe(beforeEdit.id);
    if (marker) {
      const restoredRevision = await request<{ body: string; restoredFrom: string | null }>(
        notePath(note.id) + `/revisions/${marker.id}`,
        { method: "GET", token: alice.accessToken }
      );
      expect(restoredRevision.data.body).toBe("строка 1\nстрока 2");
      expect(restoredRevision.data.restoredFrom).toBe(beforeEdit.id);
    }
  });

  it("diff версии с текущим содержимым возвращает построчные изменения", async () => {
    const note = await createNote("Diff", "первая\nвторая\nтретья");
    await request<NoteResponse>(notePath(note.id), {
      method: "PATCH",
      token: alice.accessToken,
      body: { body: "первая\nвторая исправлена\nтретья\nчетвёртая", expectedRevision: note.revision }
    });
    const revisions = await request<RevisionSummary[]>(notePath(note.id) + "/revisions", {
      method: "GET",
      token: alice.accessToken
    });
    const from = revisions.data[0];

    const diff = await request<RevisionDiff>(notePath(note.id) + `/revisions/${from.id}/diff`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(diff.status).toBe(200);
    expect(diff.data.fromRevisionId).toBe(from.id);
    expect(diff.data.toRevisionId).toBeNull();
    expect(diff.data.removed).toBe(1);
    expect(diff.data.added).toBe(2);
    expect(diff.data.lines.filter((line) => line.type === "equal").map((line) => line.text)).toEqual([
      "первая",
      "третья"
    ]);
    expect(diff.data.lines.filter((line) => line.type === "removed")[0]).toMatchObject({ text: "вторая", oldLine: 2 });
  });

  it("сохранение с [[A]] создаёт ссылку, а удаление цели помечает её битой, не удаляя", async () => {
    const target = await createNote("Цель", "тело цели");
    const source = await createNote("Источник", "См. [[Цель]] и [[Несуществующая]]");

    const links = await request<NoteLinks>(notePath(source.id) + "/links", {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.status).toBe(200);
    const toTarget = links.data.outgoing.find((entry) => entry.title === "Цель");
    expect(toTarget).toMatchObject({ noteId: target.id, broken: false });
    const missing = links.data.outgoing.find((entry) => entry.title === "Несуществующая");
    expect(missing).toMatchObject({ noteId: null, broken: true });

    // Переименование цели: ссылка больше не разрешается, но остаётся строкой.
    const renamed = await request<NoteResponse>(notePath(target.id), {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Цель переименована", expectedRevision: target.revision }
    });
    expect(renamed.status).toBe(200);
    const afterRename = await request<NoteLinks>(notePath(source.id) + "/links", {
      method: "GET",
      token: alice.accessToken
    });
    expect(afterRename.data.outgoing.find((entry) => entry.title === "Цель")).toMatchObject({ noteId: null, broken: true });

    // Возврат заголовка снова разрешает ссылку — запись не пришлось пересоздавать.
    await request<NoteResponse>(notePath(target.id), {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Цель", expectedRevision: renamed.data.revision }
    });
    const resolvedAgain = await request<NoteLinks>(notePath(source.id) + "/links", {
      method: "GET",
      token: alice.accessToken
    });
    expect(resolvedAgain.data.outgoing.find((entry) => entry.title === "Цель")).toMatchObject({
      noteId: target.id,
      broken: false
    });

    // Удаление цели (в корзину) — ссылка становится битой и видна в разборе.
    await request(notePath(target.id), { method: "DELETE", token: alice.accessToken });
    const afterDelete = await request<NoteLinks>(notePath(source.id) + "/links", {
      method: "GET",
      token: alice.accessToken
    });
    expect(afterDelete.data.outgoing.find((entry) => entry.title === "Цель")).toMatchObject({ noteId: null, broken: true });

    const broken = await request<Array<{ sourceNoteId: string; targetTitle: string }>>(
      `/workspaces/${alice.workspaceId}/notes/links/broken`,
      { method: "GET", token: alice.accessToken }
    );
    expect(broken.status).toBe(200);
    expect(broken.data).toContainEqual(expect.objectContaining({ sourceNoteId: source.id, targetTitle: "Цель" }));
  });

  it("ссылка по короткому номеру [[N-104]] разрешается в заметку", async () => {
    const target = await createNote("Номерная", "тело");
    expect(target.number).not.toBeNull();
    const source = await createNote("Ссылается на номер", `См. [[N-${target.number}]]`);
    const links = await request<NoteLinks>(notePath(source.id) + "/links", {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.status).toBe(200);
    expect(links.data.outgoing[0]).toMatchObject({ noteId: target.id, broken: false });
  });

  it("поиск внутри заметки отдаёт смещения вхождений", async () => {
    const note = await createNote("Поиск", "alpha beta\nGamma alpha");
    const found = await request<{ total: number; matches: Array<{ start: number; end: number; line: number }> }>(
      notePath(note.id) + "/search?q=alpha",
      { method: "GET", token: alice.accessToken }
    );
    expect(found.status).toBe(200);
    expect(found.data.total).toBe(2);
    expect(found.data.matches.map((match) => [match.start, match.line])).toEqual([
      [0, 1],
      [17, 2]
    ]);

    const empty = await request<{ total: number }>(notePath(note.id) + "/search?q=", {
      method: "GET",
      token: alice.accessToken
    });
    expect(empty.data.total).toBe(0);
  });

  it("связанные заметки учитывают wiki-ссылки обеих сторон и глубину 2", async () => {
    const root = await createNote("Связцентр", "корень");
    const direct = await createNote("Прямая", "[[Связцентр]]");
    const second = await createNote("Вторая", "[[Прямая]]");
    const unrelated = await createNote("Посторонняя", "ничего общего");

    const related = await request<Array<{ noteId: string; reasons: string[] }>>(notePath(root.id) + "/related", {
      method: "GET",
      token: alice.accessToken
    });
    expect(related.status).toBe(200);
    expect(related.data.find((entry) => entry.noteId === direct.id)?.reasons).toContain("backlink");
    expect(related.data.find((entry) => entry.noteId === second.id)?.reasons).toContain("wiki-link");
    expect(related.data.some((entry) => entry.noteId === unrelated.id)).toBe(false);
  });

  it("состояние стопок личное: свёрнутость и порядок, вложенность отвергается", async () => {
    const a = await createNote("Стопка A1", "");
    const b = await createNote("Стопка A2", "");
    const c = await createNote("Стопка B1", "");
    const d = await createNote("Стопка B2", "");

    const stackA = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes/stacks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Стопка A", noteIds: [a.id, b.id] }
    });
    expect(stackA.status).toBe(201);
    const stackB = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes/stacks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Стопка B", noteIds: [c.id, d.id] }
    });
    expect(stackB.status).toBe(201);

    const initial = await request<Array<{ stackId: string; collapsed: boolean; title: string }>>(
      `/workspaces/${alice.workspaceId}/notes/stacks/state`,
      { method: "GET", token: alice.accessToken }
    );
    expect(initial.status).toBe(200);
    expect(initial.data.map((entry) => entry.stackId).sort()).toEqual([stackA.data.id, stackB.data.id].sort());

    const collapsed = await request<{ collapsed: boolean }>(
      `/workspaces/${alice.workspaceId}/notes/stacks/${stackA.data.id}/state`,
      { method: "PATCH", token: alice.accessToken, body: { collapsed: true } }
    );
    expect(collapsed.status).toBe(200);
    expect(collapsed.data.collapsed).toBe(true);

    const reordered = await request(`/workspaces/${alice.workspaceId}/notes/stacks/order`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { stackIds: [stackB.data.id, stackA.data.id] }
    });
    expect([200, 204]).toContain(reordered.status);

    const after = await request<Array<{ stackId: string; collapsed: boolean }>>(
      `/workspaces/${alice.workspaceId}/notes/stacks/state`,
      { method: "GET", token: alice.accessToken }
    );
    expect(after.data.map((entry) => entry.stackId)).toEqual([stackB.data.id, stackA.data.id]);
    expect(after.data.find((entry) => entry.stackId === stackA.data.id)?.collapsed).toBe(true);

    const nested = await request(`/workspaces/${alice.workspaceId}/notes/stacks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Вложенная", noteIds: [a.id, c.id], parentStackId: stackA.data.id }
    });
    expect(nested.status).toBe(400);
  });

  it("ссылки и версии чужой заметки недоступны из другого пространства", async () => {
    const mallory = await register("mallory");
    const note = await createNote("Чужая", "тело");
    const links = await request(notePath(note.id) + "/links", { method: "GET", token: mallory.accessToken });
    expect([403, 404]).toContain(links.status);
    const cross = await request(`/workspaces/${mallory.workspaceId}/notes/${note.id}/links`, {
      method: "GET",
      token: mallory.accessToken
    });
    expect(cross.status).toBe(404);
  });

  function notePath(noteId: string): string {
    return `/workspaces/${alice.workspaceId}/notes/${noteId}`;
  }

  async function createNote(title: string, body: string): Promise<NoteResponse> {
    const created = await request<NoteResponse>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title, body }
    });
    expect(created.status).toBe(201);
    return created.data;
  }

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
