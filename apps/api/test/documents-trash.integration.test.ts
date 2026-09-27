import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { STORAGE_ADAPTER, type StorageAdapter } from "../src/storage/storage-adapter";

/**
 * S14c — data-integrity regression for `DocumentsService.remove`/`.restore`.
 *
 * Both methods move the real blob on disk (`StorageAdapter.move`) and only
 * *afterwards* write the row's `deletedAt`/`parentId` inside the same Prisma
 * transaction. `DocumentsService.update` already compensated for the "move
 * succeeded, later DB write failed" shape of this (see
 * `documents-move.integration.test.ts`) — `remove`/`restore` did not, before
 * this session's fix.
 *
 * The fault injected below is a distinct, equally real class: `storage.move`
 * itself *throws*, but only after it already relocated the blob (a network
 * storage driver like WebDAV can complete the server-side MOVE and then
 * still throw client-side on a dropped connection reading the response).
 * `update`'s original compensation ("record the keys only after the move
 * call resolves without throwing") did not cover this — the assignment
 * never ran, since the throwing call never returned normally. The fix
 * (`DocumentsService.revertIfRelocated`, applied uniformly to `update`,
 * `remove` and `restore`) records the attempted keys *before* awaiting the
 * move and, on any subsequent failure, probes which key the blob actually
 * ended up at (`storage.exists`) before deciding whether to compensate —
 * correct whether the move call threw or a later step in the transaction
 * did, and a safe no-op when the move genuinely never happened.
 *
 * Net effect of the original gap for `remove()`: the document keeps
 * `deletedAt = null` (looks live, shows up in the active list) but its blob
 * has already relocated to `.trash/<id>` — `GET .../content` 404s for a
 * document the UI still shows as present. For `restore()`: the row stays
 * `deletedAt != null` (still shown as trashed) but the blob has already left
 * `.trash/<id>` for its new live key — the trash view's own
 * preview/restore-again path 404s too. Both are exactly the CLAUDE.md
 * documents invariant violation: never a document that's visible to the
 * user with its content unreachable.
 */
describe("Documents trash/restore — blob move survives a failure after it lands (S14c)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageAdapter;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `docs-trash-${runId}`;

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

  it("a failed trash (DB write fails after the blob already moved to .trash) leaves the document live with its content still reachable", async () => {
    const alice = await register("alice");
    const doc = await uploadFile(alice.workspaceId, alice.accessToken, "a.txt", "trash-content-A");
    expect(await getContent(alice.workspaceId, alice.accessToken, doc.id)).toBe(200);

    // Let the real move happen (blob physically relocates to .trash/<id>),
    // then blow up — simulating a failure landing right after the disk
    // change but before the transaction that flips `deletedAt` commits.
    const originalMove = storage.move.bind(storage);
    const moveSpy = vi.spyOn(storage, "move").mockImplementationOnce(async (from, to) => {
      await originalMove(from, to);
      throw new Error("injected failure after blob relocated to .trash");
    });

    const del = await request(`/workspaces/${alice.workspaceId}/documents/${doc.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(del.status).toBeGreaterThanOrEqual(400);
    // One call attempts the move (and throws); a second, unmocked call is the
    // service's own compensation reverting it back.
    expect(moveSpy).toHaveBeenCalledTimes(2);

    // The document must still be reachable at its original (live) key — the
    // failed trash must not leave it "visible but broken".
    expect(await getContent(alice.workspaceId, alice.accessToken, doc.id)).toBe(200);

    const list = await request<Array<{ id: string; deletedAt: string | null }>>(
      `/workspaces/${alice.workspaceId}/documents?view=active`,
      { method: "GET", token: alice.accessToken }
    );
    expect(list.data.some((d) => d.id === doc.id)).toBe(true);
  });

  it("a failed restore (DB write fails after the blob already left .trash) leaves the document trashed with its content still reachable at .trash", async () => {
    const alice = await register("bob");
    const doc = await uploadFile(alice.workspaceId, alice.accessToken, "b.txt", "trash-content-B");
    const trashed = await request(`/workspaces/${alice.workspaceId}/documents/${doc.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(trashed.status).toBe(200);
    expect(await getContent(alice.workspaceId, alice.accessToken, doc.id)).toBe(200);

    const originalMove = storage.move.bind(storage);
    const moveSpy = vi.spyOn(storage, "move").mockImplementationOnce(async (from, to) => {
      await originalMove(from, to);
      throw new Error("injected failure after blob left .trash");
    });

    const restore = await request(`/workspaces/${alice.workspaceId}/documents/${doc.id}/restore`, {
      method: "POST",
      token: alice.accessToken
    });
    expect(restore.status).toBeGreaterThanOrEqual(400);
    // One call attempts the move (and throws); a second, unmocked call is the
    // service's own compensation reverting it back.
    expect(moveSpy).toHaveBeenCalledTimes(2);

    // The document must still be reachable via its trash key — the failed
    // restore must not leave it "trashed but content already moved out".
    expect(await getContent(alice.workspaceId, alice.accessToken, doc.id)).toBe(200);

    const list = await request<Array<{ id: string; deletedAt: string | null }>>(
      `/workspaces/${alice.workspaceId}/documents?view=trash`,
      { method: "GET", token: alice.accessToken }
    );
    expect(list.data.some((d) => d.id === doc.id)).toBe(true);
  });
});
