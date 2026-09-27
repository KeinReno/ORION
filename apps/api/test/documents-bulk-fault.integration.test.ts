import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { STORAGE_ADAPTER, type StorageAdapter } from "../src/storage/storage-adapter";

/**
 * S14c tail — `POST /documents/bulk` partial failure, end to end.
 *
 * `DocumentsService.bulk` applies one op to N ids one at a time, catching
 * each id's error individually and only rethrowing if *every* id failed
 * (12-PROGRESS.md S14c left this untested through the real HTTP endpoint).
 * Each single-item op (`update`/`remove`/`restore`) already self-compensates
 * a failure landing after its own `storage.move` lands but before its own
 * transaction commits (`revertIfRelocated`, added earlier in S14c). Because
 * `bulk` calls those methods directly rather than wrapping the whole batch
 * in one transaction, the question this test answers is: does a fault
 * injected on the K-th op out of N corrupt just that one op's document (it
 * shouldn't, since `revertIfRelocated` already covers that), while still
 * leaving the *other* N-1 ops fully applied? I.e. bulk is "apply what
 * succeeds, cleanly revert what doesn't" per item — never a half-applied
 * single item, and never silently dropping the ops around the failing one.
 */
describe("Documents bulk — a single failing op in a batch reverts only itself (S14c)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageAdapter;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `docs-bulk-fault-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    storage = app.get(STORAGE_ADAPTER);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  async function uploadFile(workspaceId: string, token: string, name: string, content: string) {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/plain" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = (await response.json()) as Array<{ id: string; name: string }>;
    expect(response.status).toBe(201);
    return data[0];
  }

  async function getContent(workspaceId: string, token: string, id: string) {
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.status;
  }

  async function listView(workspaceId: string, token: string, view: "active" | "trash") {
    const list = await request<Array<{ id: string }>>(`/workspaces/${workspaceId}/documents?view=${view}`, {
      method: "GET",
      token
    });
    return new Set(list.data.map((d) => d.id));
  }

  it("bulk-trash of 3 docs where the 2nd storage.move throws after relocating: 1st and 3rd end up trashed and reachable, the 2nd is reverted back to active and reachable — never half-trashed", async () => {
    const alice = await register("alice");
    const a = await uploadFile(alice.workspaceId, alice.accessToken, "a.txt", "content-A");
    const b = await uploadFile(alice.workspaceId, alice.accessToken, "b.txt", "content-B");
    const c = await uploadFile(alice.workspaceId, alice.accessToken, "c.txt", "content-C");

    let moveCall = 0;
    const originalMove = storage.move.bind(storage);
    const moveSpy = vi.spyOn(storage, "move").mockImplementation(async (from, to) => {
      moveCall += 1;
      await originalMove(from, to);
      // Only the 2nd move (b's trash) fails, after it already relocated the
      // blob — same "server op landed, client throws" class as the
      // single-item trash test.
      if (moveCall === 2) throw new Error("injected failure after b's blob relocated to .trash");
    });

    const bulk = await request(`/workspaces/${alice.workspaceId}/documents/bulk`, {
      method: "POST",
      token: alice.accessToken,
      body: { op: "trash", ids: [a.id, b.id, c.id] }
    });
    // Not every id failed (only b's did), so bulk() does not rethrow.
    expect(bulk.status).toBeLessThan(400);

    // a and c: cleanly trashed, content still reachable at their trash key.
    expect(await getContent(alice.workspaceId, alice.accessToken, a.id)).toBe(200);
    expect(await getContent(alice.workspaceId, alice.accessToken, c.id)).toBe(200);
    const trash = await listView(alice.workspaceId, alice.accessToken, "trash");
    expect(trash.has(a.id)).toBe(true);
    expect(trash.has(c.id)).toBe(true);
    expect(trash.has(b.id)).toBe(false);

    // b: its own failure was reverted by remove()'s own compensation — still
    // active, still reachable, NOT left half-trashed (visible-but-broken or
    // trashed-but-blob-elsewhere).
    expect(await getContent(alice.workspaceId, alice.accessToken, b.id)).toBe(200);
    const active = await listView(alice.workspaceId, alice.accessToken, "active");
    expect(active.has(b.id)).toBe(true);

    // 3 attempted moves (a, b, c) + 1 compensating revert-move for b.
    expect(moveSpy).toHaveBeenCalledTimes(4);
  });
});
