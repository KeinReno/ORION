import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * UI-03 — optional note description (`notes.summary`). Covers the whole
 * server path: create/PATCH round-trip through `toDto`, the content-edit
 * bookkeeping (revision), and — the part that is easy to forget — that the
 * full-text query and its GIN index (migration 20261008210000_note_summary)
 * really find a note by a word that exists ONLY in its summary.
 */
describe("Note summary (UI-03)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `note-summary-${runId}`;

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

  type NoteDto = { id: string; title: string; summary: string; body: string; revision: number };

  it("defaults to an empty summary and round-trips one through create and PATCH", async () => {
    const alice = await register("roundtrip");
    const plain = await request<NoteDto>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Без описания", body: "текст" }
    });
    expect(plain.status).toBe(201);
    expect(plain.data.summary).toBe("");

    const withSummary = await request<NoteDto>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "С описанием", summary: "Коротко о главном", body: "текст" }
    });
    expect(withSummary.status).toBe(201);
    expect(withSummary.data.summary).toBe("Коротко о главном");

    const patched = await request<NoteDto>(`/workspaces/${alice.workspaceId}/notes/${plain.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { summary: "Добавлено позже", expectedRevision: 1 }
    });
    expect(patched.status).toBe(200);
    expect(patched.data.summary).toBe("Добавлено позже");
    // A summary edit is a content edit: it must go through the CAS counter.
    expect(patched.data.revision).toBe(2);
  });

  it("rejects an over-long summary", async () => {
    const alice = await register("toolong");
    const response = await request(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "N", summary: "x".repeat(301) }
    });
    expect(response.status).toBe(400);
  });

  it("full-text search finds a note by a word that exists only in its summary", async () => {
    const alice = await register("search");
    const target = await request<NoteDto>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Заметка один", summary: "маршрутизация поставок", body: "ничего общего" }
    });
    await request(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Заметка два", body: "совсем другое" }
    });

    const hit = await request<NoteDto[]>(`/workspaces/${alice.workspaceId}/notes?search=${encodeURIComponent("маршрутизация")}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(hit.status).toBe(200);
    expect(hit.data.map((n) => n.id)).toEqual([target.data.id]);

    const miss = await request<NoteDto[]>(`/workspaces/${alice.workspaceId}/notes?search=${encodeURIComponent("несуществующееслово")}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(miss.data).toEqual([]);
  });

  it("version history keeps the summary, and a restore brings it back", async () => {
    const alice = await register("history");
    const base = `/workspaces/${alice.workspaceId}/notes`;
    const created = await request<NoteDto>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "H", summary: "первое описание", body: "v1" }
    });
    // The first content edit snapshots the pre-edit state (summary included).
    const edited = await request<NoteDto>(`${base}/${created.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { summary: "второе описание", body: "v2", expectedRevision: 1 }
    });
    expect(edited.status).toBe(200);

    const list = await request<Array<{ id: string }>>(`${base}/${created.data.id}/revisions`, { method: "GET", token: alice.accessToken });
    expect(list.data.length).toBeGreaterThan(0);
    const old = await request<{ summary: string; body: string }>(`${base}/${created.data.id}/revisions/${list.data[list.data.length - 1].id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(old.data.summary).toBe("первое описание");

    const restored = await request<NoteDto>(`${base}/${created.data.id}/revisions/${list.data[list.data.length - 1].id}/restore`, {
      method: "POST",
      token: alice.accessToken,
      body: { expectedRevision: edited.data.revision }
    });
    expect(restored.status).toBe(201);
    expect(restored.data.summary).toBe("первое описание");
    expect(restored.data.body).toBe("v1");
  });

  it("search also works inside the archive and never leaks archived notes into the active search", async () => {
    const alice = await register("archive-search");
    const base = `/workspaces/${alice.workspaceId}/notes`;
    const created = await request<NoteDto>(base, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Старая", summary: "квартальная инвентаризация", body: "x" }
    });
    const archivedAt = new Date().toISOString();
    expect((await request(`${base}/${created.data.id}`, { method: "PATCH", token: alice.accessToken, body: { archivedAt } })).status).toBe(200);
    const term = encodeURIComponent("инвентаризация");

    const inArchive = await request<NoteDto[]>(`${base}?view=archive&search=${term}`, { method: "GET", token: alice.accessToken });
    expect(inArchive.data.map((n) => n.id)).toEqual([created.data.id]);
    const archiveMiss = await request<NoteDto[]>(`${base}?view=archive&search=${encodeURIComponent("несуществующее")}`, { method: "GET", token: alice.accessToken });
    expect(archiveMiss.data).toEqual([]);
    const inActive = await request<NoteDto[]>(`${base}?search=${term}`, { method: "GET", token: alice.accessToken });
    expect(inActive.data).toEqual([]);
  });
});
