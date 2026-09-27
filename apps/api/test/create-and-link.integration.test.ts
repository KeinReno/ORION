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
 * U03 Часть 1 (24-CONNECTED-CORE-BACKLOG.md): "Создать задачу"/"Написать
 * заметку" from an entity's related-records picker goes through
 * `POST .../create-and-link` — one Postgres transaction
 * (`SearchService.createAndLink`) creates the new entity AND its
 * `EntityLink` together, not two sequential HTTP calls.
 *
 * Executable proof for the done-criteria in 23-UNIVERSAL-CONNECTED-CORE.md:
 * atomic for the DB (a rejected request creates neither the entity nor the
 * link — no half-created state), and an HONEST concurrency result for
 * "two simultaneous submits" — this endpoint does NOT deduplicate by
 * `idempotencyKey` server-side (see the doc comment on
 * `createAndLinkInputSchema`), so this test proves what actually happens
 * (two objects, two links) rather than asserting a guarantee the server
 * doesn't provide.
 */
describe("create-and-link (U03 Часть 1)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `cal-${runId}`;

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

  it("happy path: creates the task AND the link atomically, visible from the target's own link list", async () => {
    const alice = await register("happy-task");
    const note = await createNote(alice, "Заметка-цель");

    const res = await request<{ entityType: string; entityId: string; link: { id: string; sourceType: string; targetType: string } }>(
      `/workspaces/${alice.workspaceId}/create-and-link`,
      {
        method: "POST",
        token: alice.accessToken,
        body: {
          targetType: "note",
          targetId: note.id,
          kind: "related_to",
          entity: { type: "task", input: { title: "Проверить чек" } }
        }
      }
    );
    expect(res.status).toBe(201);
    expect(res.data.entityType).toBe("task");
    expect(res.data.link.sourceType === "task" || res.data.link.targetType === "task").toBe(true);

    // The task really exists (not just claimed by the response).
    const taskCheck = await request(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(taskCheck.status).toBe(200);
    expect((taskCheck.data as Array<{ id: string }>).some((t) => t.id === res.data.entityId)).toBe(true);

    // And the link is visible from the note's side too.
    const links = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=note&id=${note.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.data.items).toHaveLength(1);
    expect(links.data.items[0].id).toBe(res.data.link.id);
  });

  it("happy path: creates the note AND the link atomically", async () => {
    const alice = await register("happy-note");
    const task = await createTask(alice, "Задача-цель");

    const res = await request<{ entityType: string; entityId: string; link: { id: string } }>(
      `/workspaces/${alice.workspaceId}/create-and-link`,
      {
        method: "POST",
        token: alice.accessToken,
        body: {
          targetType: "task",
          targetId: task.id,
          entity: { type: "note", input: { title: "Контекст задачи", body: "Подробности" } }
        }
      }
    );
    expect(res.status).toBe(201);
    expect(res.data.entityType).toBe("note");

    const links = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=task&id=${task.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.data.items).toHaveLength(1);
  });

  it("atomicity: a target that doesn't exist rolls back the WHOLE transaction — no orphan task, no orphan link", async () => {
    const alice = await register("rollback");
    const tasksBefore = await request<Array<unknown>>(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasksBefore.status).toBe(200);
    const countBefore = tasksBefore.data.length;

    const res = await request(`/workspaces/${alice.workspaceId}/create-and-link`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        targetType: "note",
        targetId: "00000000-0000-0000-0000-000000000000",
        entity: { type: "task", input: { title: "Не должна выжить" } }
      }
    });
    expect(res.status).toBe(404);

    // No half-created task: the count is unchanged, and no task with that title exists.
    const tasksAfter = await request<Array<{ title: string }>>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(tasksAfter.data).toHaveLength(countBefore);
    expect(tasksAfter.data.some((t) => t.title === "Не должна выжить")).toBe(false);
  });

  it("atomicity: an invalid relation kind for the resulting pair rolls back the whole transaction — the entity is not left dangling without its link", async () => {
    const alice = await register("bad-kind");
    const document = await createDocument(alice, "Файл.pdf");

    // note<->document has no `evidence_for` entry in RELATION_KIND_CATALOG
    // (only document->transaction does) — createLinkTx rejects the pair
    // AFTER the note would otherwise have been created, proving the two
    // writes share one transaction rather than the note surviving a link
    // failure.
    const before = await request<Array<unknown>>(`/workspaces/${alice.workspaceId}/notes`, { method: "GET", token: alice.accessToken });
    const countBefore = before.data.length;

    const res = await request(`/workspaces/${alice.workspaceId}/create-and-link`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        targetType: "document",
        targetId: document.id,
        kind: "evidence_for",
        entity: { type: "note", input: { title: "Не должна выжить", body: "" } }
      }
    });
    expect(res.status).toBe(400);

    const after = await request<Array<{ title: string }>>(`/workspaces/${alice.workspaceId}/notes`, { method: "GET", token: alice.accessToken });
    expect(after.data).toHaveLength(countBefore);
    expect(after.data.some((n) => n.title === "Не должна выжить")).toBe(false);
  });

  it("HONEST concurrency result: two simultaneous create-and-link requests with the same idempotencyKey are NOT server-deduplicated — this documents the gap rather than hiding it", async () => {
    const alice = await register("race");
    const note = await createNote(alice, "Гонка");
    const idempotencyKey = "same-client-generated-key-for-both-requests";

    const body = {
      targetType: "note" as const,
      targetId: note.id,
      kind: "related_to" as const,
      idempotencyKey,
      entity: { type: "task" as const, input: { title: "Двойной сабмит" } }
    };

    const [first, second] = await Promise.all([
      request(`/workspaces/${alice.workspaceId}/create-and-link`, { method: "POST", token: alice.accessToken, body }),
      request(`/workspaces/${alice.workspaceId}/create-and-link`, { method: "POST", token: alice.accessToken, body })
    ]);

    // Both requests succeed independently — the server has no idea they
    // share an idempotency key. Document what actually happens: TWO tasks,
    // TWO links, not one. If a future change adds server-side dedup, this
    // assertion is exactly what should start failing (change it then, not
    // by weakening it now to make it "pass").
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const links = await request<{ items: Array<{ id: string }> }>(`/workspaces/${alice.workspaceId}/links?type=note&id=${note.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(links.data.items).toHaveLength(2);

    const tasks = await request<Array<{ title: string }>>(`/workspaces/${alice.workspaceId}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.filter((t) => t.title === "Двойной сабмит")).toHaveLength(2);
  });

  it("document entity type is rejected — create-and-link only wires up task/note in this slice", async () => {
    const alice = await register("doc-reject");
    const note = await createNote(alice, "Цель");

    const res = await request(`/workspaces/${alice.workspaceId}/create-and-link`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        targetType: "note",
        targetId: note.id,
        entity: { type: "document", input: { name: "x.pdf" } }
      }
    });
    expect(res.status).toBe(400);
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
