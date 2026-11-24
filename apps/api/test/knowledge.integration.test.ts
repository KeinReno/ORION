import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

interface KnowledgeItemDto {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  revision: number;
  origin: Record<string, unknown> | null;
  verificationState: "unverified" | "verified" | "outdated";
  lastVerifiedAt: string | null;
  verifiedById: string | null;
  verificationOverdue: boolean;
}

interface KnowledgeRevisionDto {
  id: string;
  itemId: string;
  revision: number;
  title: string;
  body: string;
  restoredFromId: string | null;
  authorId: string;
}

interface KnowledgeSearchResultDto extends KnowledgeItemDto {
  rank: number;
  snippet: string;
}

/**
 * Задание 06 «База знаний 2.0» на реальной PostgreSQL: проверка материала и её сброс,
 * полнотекстовый поиск (русский и английский, точная фраза выше), история версий и
 * восстановление, маршрутизация входящих, пофайловый импорт и агентный доступ по
 * разрешению `knowledge.item.read`.
 */
describe("Knowledge 2.0", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `knowledge20-${runId}`;

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
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function createItem(session: RegisteredSession, input: Record<string, unknown>): Promise<KnowledgeItemDto> {
    const response = await request<KnowledgeItemDto>(`/workspaces/${session.workspaceId}/knowledge/items`, {
      method: "POST",
      token: session.accessToken,
      body: input
    });
    expect(response.status, JSON.stringify(response.data)).toBe(201);
    return response.data;
  }

  it("фиксирует проверку автором и временем, а правка содержимого сбрасывает её в unverified", async () => {
    const session = await register("verify");
    const auth = { token: session.accessToken };
    const base = `/workspaces/${session.workspaceId}/knowledge`;

    const created = await createItem(session, { title: "Регламент резервного копирования", body: "Копии делаются ежедневно." });
    expect(created.verificationState).toBe("unverified");
    expect(created.verificationOverdue).toBe(true);
    expect(created.lastVerifiedAt).toBeNull();
    expect(created.verifiedById).toBeNull();

    const verified = await request<KnowledgeItemDto>(`${base}/items/${created.id}/verify`, { method: "POST", ...auth });
    expect(verified.status, JSON.stringify(verified.data)).toBe(201);
    expect(verified.data.verificationState).toBe("verified");
    expect(verified.data.verificationOverdue).toBe(false);
    expect(verified.data.verifiedById).toBe(session.user.id);
    expect(verified.data.lastVerifiedAt).toBeTruthy();

    const edited = await request<KnowledgeItemDto>(`${base}/items/${created.id}`, {
      method: "PATCH",
      ...auth,
      body: { body: "Копии делаются ежедневно и проверяются раз в месяц." }
    });
    expect(edited.status, JSON.stringify(edited.data)).toBe(200);
    expect(edited.data.verificationState).toBe("unverified");
    expect(edited.data.verificationOverdue).toBe(true);
    // История проверки не стирается: известно, кто и когда проверял в прошлый раз.
    expect(edited.data.verifiedById).toBe(session.user.id);
    expect(edited.data.lastVerifiedAt).toBe(verified.data.lastVerifiedAt);

    // Смена только статуса содержимым не считается и проверку не снимает.
    const published = await request<KnowledgeItemDto>(`${base}/items/${created.id}`, { method: "PATCH", ...auth, body: { status: "published" } });
    expect(published.status, JSON.stringify(published.data)).toBe(200);
    expect(published.data.verificationState).toBe("unverified");

    const events = await prisma.asSystem((tx) =>
      tx.domainEvent.findMany({
        where: { workspaceId: session.workspaceId, type: "knowledge.item.verification.changed" },
        orderBy: { createdAt: "asc" }
      })
    );
    expect(events.map((event) => event.payload)).toEqual([
      { id: created.id, from: "unverified", to: "verified" },
      { id: created.id, from: "verified", to: "unverified" }
    ]);
    expect(events.map((event) => event.actorId)).toEqual([session.user.id, session.user.id]);
  });

  it("порог проверки берётся из настроек, просроченные фильтруются и сортируются первыми", async () => {
    const session = await register("stale");
    const auth = { token: session.accessToken };
    const base = `/workspaces/${session.workspaceId}/knowledge`;

    const settings = await request<{ verificationDays: number; revisionLimit: number }>(`${base}/settings`, { method: "GET", ...auth });
    expect(settings.status).toBe(200);
    expect(settings.data).toEqual({ workspaceId: session.workspaceId, verificationDays: 90, revisionLimit: 20 });

    const saved = await request<{ verificationDays: number }>(`${base}/settings`, {
      method: "PATCH",
      ...auth,
      body: { verificationDays: 1, revisionLimit: 5 }
    });
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    expect(saved.data.verificationDays).toBe(1);

    const never = await createItem(session, { title: "Никогда не проверялся" });
    const old = await createItem(session, { title: "Проверялся давно" });
    const fresh = await createItem(session, { title: "Проверялся сегодня" });
    await request(`${base}/items/${old.id}/verify`, { method: "POST", ...auth });
    await request(`${base}/items/${fresh.id}/verify`, { method: "POST", ...auth });
    await prisma.asSystem((tx) =>
      tx.knowledgeItem.update({ where: { id: old.id }, data: { lastVerifiedAt: new Date(Date.now() - 5 * 86_400_000) } })
    );

    const outdated = await request<KnowledgeItemDto[]>(`${base}/items?verification=outdated`, { method: "GET", ...auth });
    expect(outdated.status).toBe(200);
    expect(outdated.data.map((item) => item.id)).toEqual([old.id]);
    expect(outdated.data[0]?.verificationState).toBe("outdated");

    const verified = await request<KnowledgeItemDto[]>(`${base}/items?verification=verified`, { method: "GET", ...auth });
    expect(verified.data.map((item) => item.id)).toEqual([fresh.id]);

    const overdue = await request<KnowledgeItemDto[]>(`${base}/items?overdue=true&sort=verification`, { method: "GET", ...auth });
    expect(overdue.status).toBe(200);
    const ids = overdue.data.map((item) => item.id);
    expect(ids).toContain(never.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
    // «Просроченные проверки»: сначала те, у кого проверки не было (NULL), затем самая старая.
    expect(ids.indexOf(never.id)).toBeLessThan(ids.indexOf(old.id));
  });

  it("ищет русский и английский текст, ранжирует точную фразу выше и отдаёт сниппет", async () => {
    const session = await register("search");
    const auth = { token: session.accessToken };
    const base = `/workspaces/${session.workspaceId}/knowledge`;

    const exact = await createItem(session, {
      title: "Аренда офиса",
      body: "Договор аренды офиса на улице Ленина продлён до конца года."
    });
    const loose = await createItem(session, {
      title: "Заметки по сделкам",
      body: "Договор купли-продажи; аренды в этом тексте нет, офиса тоже."
    });
    const english = await createItem(session, {
      title: "Office lease",
      body: "Lease agreement for the office in Berlin, signed in autumn."
    });

    const russian = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("договор аренды")}`, { method: "GET", ...auth });
    expect(russian.status, JSON.stringify(russian.data)).toBe(200);
    const russianIds = russian.data.map((item) => item.id);
    expect(russianIds).toContain(exact.id);
    expect(russianIds).toContain(loose.id);
    expect(russianIds[0]).toBe(exact.id);
    expect(russian.data[0]?.rank).toBeGreaterThan(0);
    expect(russian.data[0]?.snippet).toContain("<b>");

    const englishResult = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("lease agreement")}`, { method: "GET", ...auth });
    expect(englishResult.status).toBe(200);
    expect(englishResult.data.map((item) => item.id)).toEqual([english.id]);

    // База с локалью C: запрос с заглавными буквами обязан находить то же самое.
    const capitalized = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("Договор Аренды")}`, {
      method: "GET",
      ...auth
    });
    expect(capitalized.status).toBe(200);
    expect(capitalized.data[0]?.id).toBe(exact.id);
    expect(capitalized.data.map((item) => item.id)).toContain(loose.id);

    await request(`${base}/items/${exact.id}/verify`, { method: "POST", ...auth });
    const verifiedOnly = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("договор аренды")}&verified=true`, {
      method: "GET",
      ...auth
    });
    expect(verifiedOnly.data.map((item) => item.id)).toEqual([exact.id]);
    const unverifiedOnly = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("договор аренды")}&verified=false`, {
      method: "GET",
      ...auth
    });
    expect(unverifiedOnly.data.map((item) => item.id)).toEqual([loose.id]);

    const byType = await request<KnowledgeSearchResultDto[]>(`${base}/search?q=${encodeURIComponent("офиса")}&type=link`, { method: "GET", ...auth });
    expect(byType.data).toHaveLength(0);

    const tooShort = await request(`${base}/search?q=я`, { method: "GET", ...auth });
    expect(tooShort.status).toBe(400);

    // Провайдер глобального поиска (задание 10) отдаёт материал тем же типом `knowledge_item`.
    const global = await request<Array<{ type: string; id: string }>>(
      `/workspaces/${session.workspaceId}/search?q=${encodeURIComponent("договор аренды")}`,
      { method: "GET", ...auth }
    );
    expect(global.status, JSON.stringify(global.data)).toBe(200);
    expect(global.data.some((row) => row.type === "knowledge_item" && row.id === exact.id)).toBe(true);
  });

  it("восстанавливает версию, не затирая историю: две новые правки после restore различимы", async () => {
    const session = await register("revisions");
    const auth = { token: session.accessToken };
    const base = `/workspaces/${session.workspaceId}/knowledge`;

    const item = await createItem(session, { title: "Версия 1", body: "исходный текст" });
    const first = await request<KnowledgeRevisionDto>(`${base}/items/${item.id}/revisions`, { method: "POST", ...auth });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data.body).toBe("исходный текст");
    expect(first.data.authorId).toBe(session.user.id);

    await request(`${base}/items/${item.id}`, { method: "PATCH", ...auth, body: { title: "Версия 2", body: "второй текст" } });
    const second = await request<KnowledgeRevisionDto>(`${base}/items/${item.id}/revisions`, { method: "POST", ...auth });
    expect(second.status).toBe(201);
    expect(second.data.body).toBe("второй текст");

    await request(`${base}/items/${item.id}/verify`, { method: "POST", ...auth });
    const restored = await request<KnowledgeItemDto>(`${base}/items/${item.id}/revisions/${first.data.id}/restore`, {
      method: "POST",
      ...auth
    });
    expect(restored.status, JSON.stringify(restored.data)).toBe(201);
    expect(restored.data.title).toBe("Версия 1");
    expect(restored.data.body).toBe("исходный текст");
    // Восстановление — правка содержимого: подтверждение снимается, номер ревизии растёт.
    expect(restored.data.verificationState).toBe("unverified");
    expect(restored.data.revision).toBeGreaterThan(2);

    await request(`${base}/items/${item.id}`, { method: "PATCH", ...auth, body: { body: "третий текст" } });
    const third = await request<KnowledgeRevisionDto>(`${base}/items/${item.id}/revisions`, { method: "POST", ...auth });
    await request(`${base}/items/${item.id}`, { method: "PATCH", ...auth, body: { body: "четвёртый текст" } });
    const fourth = await request<KnowledgeRevisionDto>(`${base}/items/${item.id}/revisions`, { method: "POST", ...auth });
    expect(fourth.status).toBe(201);

    const history = await request<KnowledgeRevisionDto[]>(`${base}/items/${item.id}/revisions`, { method: "GET", ...auth });
    expect(history.status).toBe(200);
    const byId = new Map(history.data.map((revision) => [revision.id, revision]));
    // Старые версии не перезаписаны восстановлением.
    expect(byId.get(first.data.id)?.body).toBe("исходный текст");
    expect(byId.get(second.data.id)?.body).toBe("второй текст");
    // Две новые правки после restore — разные снимки с разным содержимым.
    expect(third.data.id).not.toBe(fourth.data.id);
    expect(byId.get(third.data.id)?.body).toBe("третий текст");
    expect(byId.get(fourth.data.id)?.body).toBe("четвёртый текст");
    const restoreSnapshot = history.data.find((revision) => revision.restoredFromId === first.data.id);
    expect(restoreSnapshot?.body).toBe("исходный текст");

    // Лимит хранения: 5 версий — старые снимки обрезаются, новые остаются.
    await request(`${base}/settings`, { method: "PATCH", ...auth, body: { revisionLimit: 2 } });
    await request(`${base}/items/${item.id}/revisions`, { method: "POST", ...auth });
    const limited = await request<KnowledgeRevisionDto[]>(`${base}/items/${item.id}/revisions`, { method: "GET", ...auth });
    expect(limited.data).toHaveLength(2);
    expect(limited.data[0]?.id).not.toBe(first.data.id);
  });

  it("копирует общую заметку со ссылкой на источник и отклоняет личную заметку", async () => {
    const user = await register("import-note");
    const token = user.accessToken;
    const workspacePath = `/workspaces/${user.workspaceId}`;
    const createNote = (isPrivate: boolean) => request<{ id: string }>(`${workspacePath}/notes`, {
      method: "POST", token, body: { title: "Импорт заметки", body: "Текст источника", isPrivate }
    });
    const shared = await createNote(false);
    const personal = await createNote(true);
    expect(shared.status).toBe(201);
    expect(personal.status).toBe(201);
    const importNote = (id: string) => request<{ itemId: string }>(`${workspacePath}/knowledge/from-note/${id}`, { method: "POST", token });
    expect((await importNote(personal.data.id)).status).toBe(404);
    const imported = await importNote(shared.data.id);
    expect(imported.status).toBe(201);
    const detail = await request(`${workspacePath}/knowledge/items/${imported.data.itemId}`, { method: "GET", token });
    expect(detail.data).toMatchObject({
      body: "Текст источника", sources: [expect.objectContaining({ type: "note", noteId: shared.data.id })]
    });
  });

  it("импортирует файлы пофайлово и маршрутизирует входящее с отдельным подтверждением удаления", async () => {
    const session = await register("import");
    const auth = { token: session.accessToken };
    const base = `/workspaces/${session.workspaceId}/knowledge`;

    const [document, missing] = await prisma.asSystem(async (tx) => {
      const created = await tx.document.create({
        data: { workspaceId: session.workspaceId, kind: "file", name: "Регламент безопасности.pdf", mimeType: "application/pdf", sizeBytes: 12, checksum: "test" }
      });
      return [created, "00000000-0000-4000-8000-000000000000"];
    });

    const report = await request<{ okCount: number; failedCount: number; results: Array<{ documentId: string; ok: boolean; itemId: string | null; error: string | null }> }>(
      `${base}/import/documents`,
      { method: "POST", ...auth, body: { documentIds: [document.id, missing] } }
    );
    expect(report.status, JSON.stringify(report.data)).toBe(201);
    expect(report.data.okCount).toBe(1);
    expect(report.data.failedCount).toBe(1);
    expect(report.data.results[1]?.error).toContain("не найден");

    const imported = await request<KnowledgeItemDto & { sources: Array<{ type: string; documentId: string | null }> }>(
      `${base}/items/${report.data.results[0]?.itemId}`,
      { method: "GET", ...auth }
    );
    expect(imported.status).toBe(200);
    expect(imported.data.title).toBe("Регламент безопасности");
    expect(imported.data.origin).toMatchObject({ sourceFile: "Регламент безопасности.pdf", importedBy: session.user.id });
    expect(imported.data.sources[0]).toMatchObject({ type: "document", documentId: document.id });

    const captured = await request<{ id: string }>(`/workspaces/${session.workspaceId}/inbox`, {
      method: "POST",
      ...auth,
      body: { title: "Полезная статья", body: "Читать: https://example.com/article" }
    });
    expect(captured.status).toBe(201);

    const routed = await request<{ item: KnowledgeItemDto; removedFromInbox: boolean }>(
      `${base}/from-inbox/${captured.data.id}`,
      { method: "POST", ...auth, body: { deleteFromInbox: true } }
    );
    expect(routed.status, JSON.stringify(routed.data)).toBe(201);
    expect(routed.data.removedFromInbox).toBe(true);
    expect(routed.data.item.status).toBe("captured");
    expect(routed.data.item.origin).toMatchObject({ sourceUrl: "https://example.com/article", importedBy: session.user.id });

    const gone = await request(`/workspaces/${session.workspaceId}/inbox`, { method: "GET", ...auth });
    expect(JSON.stringify(gone.data)).not.toContain(captured.data.id);

    const keptCapture = await request<{ id: string }>(`/workspaces/${session.workspaceId}/inbox`, {
      method: "POST",
      ...auth,
      body: { title: "Мысль", body: "Просто текст" }
    });
    const routedKept = await request<{ removedFromInbox: boolean }>(`${base}/from-inbox/${keptCapture.data.id}`, {
      method: "POST",
      ...auth,
      body: {}
    });
    expect(routedKept.status).toBe(201);
    expect(routedKept.data.removedFromInbox).toBe(false);
    const inboxAfter = await request<{ items: Array<{ id: string }> }>(`/workspaces/${session.workspaceId}/inbox`, { method: "GET", ...auth });
    expect(inboxAfter.data.items.map((item) => item.id)).toContain(keptCapture.data.id);
  });

  it("не даёт агенту читать базу знаний без разрешения knowledge.item.read и пишет журнал чтения", async () => {
    const session = await register("agent");
    const auth = { token: session.accessToken };
    const item = await createItem(session, { title: "Секрет производства", body: "Рецепт хранится в сейфе." });

    const without = await request<{ secret: string }>(`/workspaces/${session.workspaceId}/agent-tokens`, {
      method: "POST",
      ...auth,
      body: { name: "Читатель заметок", mode: "observer", scopes: ["notes:read"] }
    });
    expect(without.status, JSON.stringify(without.data)).toBe(201);
    const denied = await request(`/ai/v1/knowledge/search?q=${encodeURIComponent("рецепт")}`, {
      method: "GET",
      token: without.data.secret
    });
    expect(denied.status).toBe(403);

    const withPermission = await request<{ id: string; secret: string }>(`/workspaces/${session.workspaceId}/agent-tokens`, {
      method: "POST",
      ...auth,
      body: { name: "Библиотекарь", mode: "observer", modulePermissions: ["knowledge.item.read"] }
    });
    expect(withPermission.status, JSON.stringify(withPermission.data)).toBe(201);

    const found = await request<KnowledgeSearchResultDto[]>(`/ai/v1/knowledge/search?q=${encodeURIComponent("рецепт")}`, {
      method: "GET",
      token: withPermission.data.secret
    });
    expect(found.status, JSON.stringify(found.data)).toBe(200);
    expect(found.data.map((row) => row.id)).toContain(item.id);
    expect(found.data[0]?.verificationState).toBe("unverified");

    const read = await request<KnowledgeItemDto & { sources: unknown[] }>(`/ai/v1/knowledge/items/${item.id}`, {
      method: "GET",
      token: withPermission.data.secret
    });
    expect(read.status, JSON.stringify(read.data)).toBe(200);
    expect(read.data.verificationState).toBe("unverified");

    const audit = await prisma.asSystem((tx) =>
      tx.agentAuditEntry.findMany({ where: { workspaceId: session.workspaceId, tokenId: withPermission.data.id }, orderBy: { createdAt: "asc" } })
    );
    expect(audit.map((entry) => entry.action)).toEqual(["orion_knowledge_search", "orion_knowledge_read"]);
    expect(audit[1]?.objectId).toBe(item.id);
    expect(audit[1]?.summary).toContain("проверка: unverified");  });
});
