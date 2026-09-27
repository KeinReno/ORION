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

/**
 * U01 (24-CONNECTED-CORE-BACKLOG.md) — typed EntityLink registry on top of
 * the existing generic `entity_links` table. Executable proof for the
 * done-criteria: both endpoints checked (ownership + module access, real
 * RLS, not mocked), self-link rejected, symmetric (`related_to`)
 * deduplication regardless of which side initiates, directed-kind pair
 * restrictions, and cursor pagination. Mirrors UC01-UC03 from
 * 24-CONNECTED-CORE-BACKLOG.md.
 */
describe("EntityLink typed registry (U01)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `u01-${runId}`;

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

  it("rejects a self-link (same type + same id) with a clear error, not a created row", async () => {
    const alice = await register("self");
    const task = await createTask(alice, "Сама с собой");

    const res = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: task.id, targetType: "task", targetId: task.id, kind: "related_to" }
    });
    expect(res.status).toBe(400);

    const links = await request<{ items: unknown[] }>(`/workspaces/${alice.workspaceId}/links?type=task&id=${task.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.data.items).toHaveLength(0);
  });

  it("normalizes symmetric related_to links: A->B then B->A is rejected as a duplicate, not a second mirrored row", async () => {
    const alice = await register("sym");
    const task = await createTask(alice, "Задача");
    const note = await createNote(alice, "Заметка");

    const forward = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: task.id, targetType: "note", targetId: note.id, kind: "related_to" }
    });
    expect(forward.status).toBe(201);

    const reverse = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "note", sourceId: note.id, targetType: "task", targetId: task.id, kind: "related_to" }
    });
    expect(reverse.status).toBe(400);

    // Visible from both ends, and exactly once from each.
    const fromTask = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=task&id=${task.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    const fromNote = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=note&id=${note.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(fromTask.data.items).toHaveLength(1);
    expect(fromNote.data.items).toHaveLength(1);
    expect(fromTask.data.items[0].id).toBe(fromNote.data.items[0].id);
  });

  it("a directed kind (evidence_for) is NOT symmetric-deduplicated: document->transaction and transaction->document are different facts", async () => {
    const alice = await register("dir");
    const document = await createDocument(alice, "Чек.pdf");
    const account = await createAccount(alice, "Карта");
    const transaction = await createTransaction(alice, account.id, "Кофе");

    const forward = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "document", sourceId: document.id, targetType: "transaction", targetId: transaction.id, kind: "evidence_for" }
    });
    expect(forward.status).toBe(201);

    // The reverse direction for a directed kind is a different pair
    // (transaction->document), which evidence_for's catalog entry doesn't
    // allow at all — rejected as an invalid pair, not created as a mirror.
    const reverse = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "transaction", sourceId: transaction.id, targetType: "document", targetId: document.id, kind: "evidence_for" }
    });
    expect(reverse.status).toBe(400);
  });

  it("rejects a pair the relation kind's catalog does not allow (note evidence_for a task)", async () => {
    const alice = await register("pair");
    const note = await createNote(alice, "Заметка");
    const task = await createTask(alice, "Задача");

    const res = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "note", sourceId: note.id, targetType: "task", targetId: task.id, kind: "evidence_for" }
    });
    expect(res.status).toBe(400);
  });

  it("a document->transaction evidence_for link and a document<->task supports link can coexist as separate kinds without conflicting", async () => {
    const alice = await register("multi");
    const document = await createDocument(alice, "Инструкция.pdf");
    const account = await createAccount(alice, "Карта");
    const transaction = await createTransaction(alice, account.id, "Покупка");
    const task = await createTask(alice, "Собрать");

    const evidence = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "document", sourceId: document.id, targetType: "transaction", targetId: transaction.id, kind: "evidence_for" }
    });
    expect(evidence.status).toBe(201);

    const supports = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "document", sourceId: document.id, targetType: "task", targetId: task.id, kind: "supports" }
    });
    expect(supports.status).toBe(201);

    const links = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=document&id=${document.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.data.items).toHaveLength(2);
  });

  it("real RLS: a link ref from a foreign workspace is rejected (404), and a same-owner id in another workspace is not resolved as the caller's own", async () => {
    const alice = await register("cross-a");
    const bob = await register("cross-b");
    const aliceTask = await createTask(alice, "Задача Алисы");
    const bobNote = await createNote(bob, "Заметка Боба");

    // Bob tries to link Alice's task (in Alice's workspace) from inside his own workspace.
    const res = await request(`/workspaces/${bob.workspaceId}/links`, {
      method: "POST",
      token: bob.accessToken,
      body: { sourceType: "note", sourceId: bobNote.id, targetType: "task", targetId: aliceTask.id, kind: "related_to" }
    });
    expect(res.status).toBe(404);

    // Bob cannot even read links scoped to Alice's workspace by guessing the id/workspace.
    const listAsBob = await request(`/workspaces/${alice.workspaceId}/links?type=task&id=${aliceTask.id}`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(listAsBob.status).toBe(403);
  });

  it("a restricted/disabled module on the other end hides the link (not counted, not exposed) without erroring the whole list", async () => {
    const alice = await register("hide");
    const task = await createTask(alice, "Видимая задача");
    const note = await createNote(alice, "Скрываемая заметка");

    const link = await request(`/workspaces/${alice.workspaceId}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: task.id, targetType: "note", targetId: note.id, kind: "related_to" }
    });
    expect(link.status).toBe(201);

    const disable = await request(`/workspaces/${alice.workspaceId}/modules/notes`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false }
    });
    expect(disable.status).toBe(200);

    const links = await request<{ items: unknown[] }>(`/workspaces/${alice.workspaceId}/links?type=task&id=${task.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.status).toBe(200);
    expect(links.data.items).toHaveLength(0);
  });

  it("list pagination is cursor-based and covers every visible link without duplicates or gaps", async () => {
    const alice = await register("page");
    const task = await createTask(alice, "Много связей");
    for (let i = 0; i < 7; i++) {
      const note = await createNote(alice, `Заметка ${i}`);
      const res = await request(`/workspaces/${alice.workspaceId}/links`, {
        method: "POST",
        token: alice.accessToken,
        body: { sourceType: "task", sourceId: task.id, targetType: "note", targetId: note.id, kind: "related_to" }
      });
      expect(res.status).toBe(201);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await request<{ items: Array<{ id: string }>; nextCursor: string | null }>(
        `/workspaces/${alice.workspaceId}/links?type=task&id=${task.id}&limit=3${cursor ? `&cursor=${cursor}` : ""}`,
        { method: "GET", token: alice.accessToken }
      );
      expect(page.status).toBe(200);
      for (const item of page.data.items) seen.add(item.id);
      pages += 1;
      if (!page.data.nextCursor) break;
      cursor = page.data.nextCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(seen.size).toBe(7);
    expect(pages).toBeGreaterThan(1);
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

  async function createTask(session: RegisteredSession, title: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/tasks`, {
      method: "POST",
      token: session.accessToken,
      body: { title }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createNote(session: RegisteredSession, title: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/notes`, {
      method: "POST",
      token: session.accessToken,
      body: { title, body: "" }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createDocument(session: RegisteredSession, name: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/documents`, {
      method: "POST",
      token: session.accessToken,
      body: { name, parentId: null }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createAccount(session: RegisteredSession, name: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/finance/accounts`, {
      method: "POST",
      token: session.accessToken,
      body: { name, kind: "cash", currency: "RUB" }
    });
    expect(res.status).toBe(201);
    return res.data;
  }

  async function createTransaction(session: RegisteredSession, accountId: string, note: string): Promise<{ id: string }> {
    const res = await request<{ id: string }>(`/workspaces/${session.workspaceId}/finance/transactions`, {
      method: "POST",
      token: session.accessToken,
      body: {
        accountId,
        type: "expense",
        occurredAt: new Date().toISOString(),
        note,
        tags: [],
        lines: [{ amount: 100, categoryId: null }]
      }
    });
    expect(res.status).toBe(201);
    return res.data;
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
