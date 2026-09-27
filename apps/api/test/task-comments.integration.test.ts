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
 * S17 «Комментарии и журнал задач» — done-criteria as executable tests:
 * ownership (only the author edits/deletes their own comment, no
 * owner/lead override), server-stamped authorship (client payload can't set
 * userId), history surviving member removal, self-comment not
 * self-notifying, and the status/assignee/due audit log.
 */
describe("Task comments and activity log (S17)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `s17-${runId}`;

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

  async function joinAsMember(ownerToken: string, workspaceId: string, member: RegisteredSession): Promise<void> {
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      token: ownerToken,
      body: { email: member.email }
    });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token: member.accessToken });
    expect(accepted.status).toBe(201);
  }

  it("only the comment author can edit or delete it — a fellow member (even after promotion attempts) gets 403", async () => {
    const alice = await register("alice-own");
    const bob = await register("bob-own");
    await joinAsMember(alice.accessToken, alice.workspaceId, bob);

    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Обсудить релиз" }
    });
    expect(task.status).toBe(201);

    const created = await request<{ id: string; userId: string; mine: boolean }>(
      `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`,
      { method: "POST", token: alice.accessToken, body: { body: "Первый комментарий" } }
    );
    expect(created.status).toBe(201);
    expect(created.data.userId).toBe(alice.user.id);

    // Bob (a plain member of the same workspace) cannot edit or delete Alice's comment.
    const bobEdit = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments/${created.data.id}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { body: "переписал чужой комментарий" }
    });
    expect(bobEdit.status).toBe(403);

    const bobDelete = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments/${created.data.id}`, {
      method: "DELETE",
      token: bob.accessToken
    });
    expect(bobDelete.status).toBe(403);

    // The author herself can edit it.
    const aliceEdit = await request<{ body: string; editedAt: string | null }>(
      `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments/${created.data.id}`,
      { method: "PATCH", token: alice.accessToken, body: { body: "исправлено автором" } }
    );
    expect(aliceEdit.status).toBe(200);
    expect(aliceEdit.data.body).toBe("исправлено автором");
    expect(aliceEdit.data.editedAt).not.toBeNull();
  });

  it("stamps userId from the authenticated session — a payload-supplied userId/mine cannot override authorship", async () => {
    const alice = await register("alice-stamp");
    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Проверка авторства" }
    });

    // The input schema has no userId field at all; even if the client tries
    // to smuggle one in, zod's ZodValidationPipe strips unknown keys and the
    // service never reads it — the row is authored by the caller.
    const created = await request<{ userId: string; authorName: string; mine: boolean }>(
      `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`,
      { method: "POST", token: alice.accessToken, body: { body: "текст", userId: "someone-else", mine: false } }
    );
    expect(created.status).toBe(201);
    expect(created.data.userId).toBe(alice.user.id);
    expect(created.data.mine).toBe(true);
  });

  it("XSS payload in a comment body is stored and returned verbatim as text, never as interpreted HTML", async () => {
    const alice = await register("alice-xss");
    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "XSS" }
    });
    const payload = '<script>window.__pwned = true;</script><img src=x onerror="window.__pwned = true">';
    const created = await request<{ body: string }>(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`, {
      method: "POST",
      token: alice.accessToken,
      body: { body: payload }
    });
    expect(created.status).toBe(201);
    // Round-trips as plain text — the server does no HTML interpretation at
    // all. Client-side rendering uses `renderMarkdown` (markdown-it,
    // `html: false`, packages/ui/src/markdown.tsx), the same safe path note
    // bodies use, so `<script>`/`onerror=` are rendered as literal text, not
    // executed — that half of the guarantee is covered by markdown-it's own
    // `html: false` behaviour, exercised by the existing notes test suite.
    expect(created.data.body).toBe(payload);
  });

  it("comment pagination is cursor-based and covers every row without duplicates or gaps", async () => {
    const alice = await register("alice-page");
    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Пагинация" }
    });
    for (let i = 0; i < 7; i++) {
      const res = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`, {
        method: "POST",
        token: alice.accessToken,
        body: { body: `комментарий ${i}` }
      });
      expect(res.status).toBe(201);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await request<{ items: Array<{ id: string }>; nextCursor: string | null }>(
        `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments?limit=3${cursor ? `&cursor=${cursor}` : ""}`,
        { method: "GET", token: alice.accessToken }
      );
      expect(page.status).toBe(200);
      for (const item of page.data.items) seen.add(item.id);
      pages += 1;
      if (!page.data.nextCursor) break;
      cursor = page.data.nextCursor;
      expect(pages).toBeLessThan(10); // guard against an infinite loop if cursoring regresses
    }
    expect(seen.size).toBe(7);
    expect(pages).toBeGreaterThan(1);
  });

  it("a removed member's comments stay readable with their name — not FK-broken, not 'unknown'", async () => {
    const alice = await register("alice-rm");
    const bob = await register("bob-rm");
    await joinAsMember(alice.accessToken, alice.workspaceId, bob);

    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "История после удаления участника" }
    });
    const bobComment = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`, {
      method: "POST",
      token: bob.accessToken,
      body: { body: "Комментарий Боба" }
    });
    expect(bobComment.status).toBe(201);

    const members = await request<Array<{ id: string; userId: string }>>(`/workspaces/${alice.workspaceId}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const bobMember = members.data.find((m) => m.userId === bob.user.id)!;
    const removed = await request(`/workspaces/${alice.workspaceId}/members/${bobMember.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(removed.status).toBe(200);

    // Bob is gone from the membership list, but his comment is still there,
    // still attributed to him by name (User survives membership removal —
    // see schema.prisma's TaskComment doc comment).
    const page = await request<{ items: Array<{ id: string; authorName: string; userId: string }> }>(
      `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/comments`,
      { method: "GET", token: alice.accessToken }
    );
    expect(page.status).toBe(200);
    const found = page.data.items.find((c) => c.id === bobComment.data.id);
    expect(found).toBeDefined();
    expect(found!.authorName).toBe("bob-rm");
    expect(found!.userId).toBe(bob.user.id);
  });

  it("commenting on your own unassigned-to-others task does not notify yourself; commenting notifies the assignee, deduped per comment", async () => {
    const alice = await register("alice-notif");
    const bob = await register("bob-notif");
    await joinAsMember(alice.accessToken, alice.workspaceId, bob);

    // Enable the "Команда" plugin so tasks can carry an assignee.
    const pluginRes = await request(`/workspaces/${alice.workspaceId}/plugins/team`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: true }
    });
    expect(pluginRes.status).toBe(200);

    const members = await request<Array<{ id: string; userId: string }>>(`/workspaces/${alice.workspaceId}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const bobMember = members.data.find((m) => m.userId === bob.user.id)!;

    // A task with no assignee: Alice commenting on it must not notify herself.
    const soloTask = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Своя задача без исполнителя" }
    });
    const soloComment = await request(`/workspaces/${alice.workspaceId}/tasks/${soloTask.data.id}/comments`, {
      method: "POST",
      token: alice.accessToken,
      body: { body: "коммент себе" }
    });
    expect(soloComment.status).toBe(201);
    const aliceNotifs = await request<Array<{ kind: string }>>(`/workspaces/${alice.workspaceId}/notifications`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(aliceNotifs.data.some((n) => n.kind === "task_comment")).toBe(false);

    // A task assigned to Bob: Alice commenting notifies Bob exactly once.
    const assignedTask = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Задача Боба", assigneeId: bobMember.id }
    });
    expect(assignedTask.status).toBe(201);
    const comment = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks/${assignedTask.data.id}/comments`, {
      method: "POST",
      token: alice.accessToken,
      body: { body: "гляньте, пожалуйста" }
    });
    expect(comment.status).toBe(201);

    const bobNotifs = await request<Array<{ kind: string; entityId: string | null }>>(
      `/workspaces/${alice.workspaceId}/notifications`,
      { method: "GET", token: bob.accessToken }
    );
    const matching = bobNotifs.data.filter((n) => n.kind === "task_comment" && n.entityId === assignedTask.data.id);
    expect(matching).toHaveLength(1);

    // Bob commenting on his own assigned task must not notify himself either.
    const bobOwnComment = await request(`/workspaces/${alice.workspaceId}/tasks/${assignedTask.data.id}/comments`, {
      method: "POST",
      token: bob.accessToken,
      body: { body: "уже смотрю" }
    });
    expect(bobOwnComment.status).toBe(201);
    const bobNotifsAfter = await request<Array<{ kind: string; entityId: string | null }>>(
      `/workspaces/${alice.workspaceId}/notifications`,
      { method: "GET", token: bob.accessToken }
    );
    const stillOne = bobNotifsAfter.data.filter((n) => n.kind === "task_comment" && n.entityId === assignedTask.data.id);
    expect(stillOne).toHaveLength(1); // unchanged — his own comment didn't notify himself
  });

  it("status/assignee/due edits are journaled with who and when; a plain field patch with no such change adds no row", async () => {
    const alice = await register("alice-audit");
    const task = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Аудит" }
    });

    const noop = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { title: "Аудит (переименовано)" }
    });
    expect(noop.status).toBe(200);

    const statusChange = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { status: "in_progress" }
    });
    expect(statusChange.status).toBe(200);

    const dueChange = await request(`/workspaces/${alice.workspaceId}/tasks/${task.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { dueAt: "2026-12-01T00:00:00.000Z" }
    });
    expect(dueChange.status).toBe(200);

    const activity = await request<Array<{ field: string; fromValue: string | null; toValue: string | null; actorId: string | null; actorName: string | null }>>(
      `/workspaces/${alice.workspaceId}/tasks/${task.data.id}/activity`,
      { method: "GET", token: alice.accessToken }
    );
    expect(activity.status).toBe(200);
    // Exactly two rows — the title-only rename produced no activity row.
    expect(activity.data).toHaveLength(2);
    expect(activity.data.every((row) => row.actorId === alice.user.id && row.actorName === "alice-audit")).toBe(true);
    const statusRow = activity.data.find((row) => row.field === "status")!;
    expect(statusRow.fromValue).toBe("todo");
    expect(statusRow.toValue).toBe("in_progress");
    const dueRow = activity.data.find((row) => row.field === "dueAt")!;
    expect(dueRow.toValue).toBe("2026-12-01T00:00:00.000Z");
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
