import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S11 — server-side half of the CAS (compare-and-swap) revision check that
 * the client's `NoteAutosave` trailing-drain controller relies on
 * (`apps/web/lib/note-autosave.test.ts` covers the client state machine with
 * fake timers/deferred promises; this covers the real HTTP + Postgres path
 * `NotesService.update` runs the check against).
 */
describe("Notes CAS (expectedRevision)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `note-cas-${runId}`;

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

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  it("a fresh note starts at revision 1, and a matching expectedRevision saves and bumps it", async () => {
    const alice = await register("fresh");
    const created = await request<{ id: string; revision: number }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "N", body: "v1" }
    });
    expect(created.status).toBe(201);
    expect(created.data.revision).toBe(1);

    const updated = await request<{ revision: number; body: string }>(
      `/workspaces/${alice.workspaceId}/notes/${created.data.id}`,
      { method: "PATCH", token: alice.accessToken, body: { body: "v2", expectedRevision: 1 } }
    );
    expect(updated.status).toBe(200);
    expect(updated.data.revision).toBe(2);
    expect(updated.data.body).toBe("v2");
  });

  it("rejects a stale expectedRevision with 409 and returns the server's real current content — the two-client race this whole card exists for", async () => {
    const alice = await register("race");
    const created = await request<{ id: string; revision: number }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "N", body: "start" }
    });
    const noteId = created.data.id;

    // "Tab A" saves first, moving the note to revision 2.
    const tabA = await request<{ revision: number }>(`/workspaces/${alice.workspaceId}/notes/${noteId}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { body: "from tab A", expectedRevision: 1 }
    });
    expect(tabA.status).toBe(200);
    expect(tabA.data.revision).toBe(2);

    // "Tab B" still thinks the note is at revision 1 (it loaded before A saved)
    // and tries to save its own edit — must be rejected, not silently applied
    // over A's change.
    const tabB = await request<{ code: string; currentRevision: number; current: { body: string } }>(
      `/workspaces/${alice.workspaceId}/notes/${noteId}`,
      { method: "PATCH", token: alice.accessToken, body: { body: "from tab B", expectedRevision: 1 } }
    );
    expect(tabB.status).toBe(409);
    expect(tabB.data.code).toBe("note_revision_conflict");
    expect(tabB.data.currentRevision).toBe(2);
    expect(tabB.data.current.body).toBe("from tab A"); // real current server content, not tab B's stale view

    // The row itself must still hold A's content — the rejected write never
    // landed. There's no GET /:id route, so list and find it (same as other
    // tests in this suite do).
    const list = await request<Array<{ id: string; body: string; revision: number }>>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "GET",
      token: alice.accessToken
    });
    const row = list.data.find((n) => n.id === noteId);
    expect(row?.body).toBe("from tab A");
    expect(row?.revision).toBe(2);
  });

  it("an update WITHOUT expectedRevision (e.g. pin/archive toggle) is not CAS-gated and still bumps the counter", async () => {
    const alice = await register("untracked");
    const created = await request<{ id: string; revision: number }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "N", body: "x" }
    });
    const pin = await request<{ revision: number; pinnedAt: string | null }>(`/workspaces/${alice.workspaceId}/notes/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { pinnedAt: new Date().toISOString() }
    });
    expect(pin.status).toBe(200);
    expect(pin.data.pinnedAt).not.toBeNull();
    expect(pin.data.revision).toBe(2);
  });
  it("tag rename/delete, trash and restore also bump the revision, so a stale editor gets a conflict instead of overwriting them", async () => {
    const alice = await register("direct");
    const ws = alice.workspaceId;
    const note = await request<{ id: string }>(`/workspaces/${ws}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "N", body: "x", tags: ["a", "b"] }
    });
    const revisionOf = async () => {
      const list = await request<Array<{ id: string; revision: number }>>(`/workspaces/${ws}/notes`, { method: "GET", token: alice.accessToken });
      return list.data.find((n) => n.id === note.data.id)?.revision;
    };
    expect(await revisionOf()).toBe(1);

    await request(`/workspaces/${ws}/notes/tags/rename`, { method: "POST", token: alice.accessToken, body: { from: "a", to: "c" } });
    expect(await revisionOf()).toBe(2);
    await request(`/workspaces/${ws}/notes/tags/${encodeURIComponent("b")}`, { method: "DELETE", token: alice.accessToken });
    expect(await revisionOf()).toBe(3);

    // Редактор, открытый на ревизии 1, больше не может молча затереть теги.
    const stale = await request<{ code: string }>(`/workspaces/${ws}/notes/${note.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { body: "stale", expectedRevision: 1 }
    });
    expect(stale.status).toBe(409);

    await request(`/workspaces/${ws}/notes/${note.data.id}`, { method: "DELETE", token: alice.accessToken });
    await request(`/workspaces/${ws}/notes/${note.data.id}/restore`, { method: "POST", token: alice.accessToken });
    expect(await revisionOf()).toBe(5);
  });
});
