import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { STORAGE_ADAPTER, type StorageAdapter } from "../src/storage/storage-adapter";

/**
 * S14c tail — data-integrity regression for `DocumentsService.replaceContent`
 * / `.restoreVersion`.
 *
 * Both methods overwrite the *live* blob in place (`storage.putFile` /
 * `storage.copy`) after archiving the previous content as a
 * `DocumentVersion` inside the same Prisma transaction. Unlike `update` /
 * `remove` / `restore` (which move a blob and can always move it back), this
 * write is destructive: once it lands, the previous bytes at the live key are
 * gone unless restored from the just-made archive copy.
 *
 * Before this session's fix, a failure landing *after* the disk write
 * physically completed but before the wrapping transaction committed (same
 * fault class as the WebDAV "server op landed, client throws" case already
 * covered for `update`/`remove`/`restore` — see
 * `documents-trash.integration.test.ts`) left the live blob holding the
 * *new* bytes while the DB row still described the *old* ones (`checksum`,
 * `sizeBytes`, `mimeType` never got the `tx.document.update` that follows the
 * write, since the transaction rolled back). The document stays visible and
 * its content stream still 200s — so the existing "orphan blob at worst"
 * class of test doesn't catch it — but the bytes served no longer match what
 * the DB claims about them, and the true previous content is only reachable
 * at an orphaned `.versions/<id>/<n>` key with no `DocumentVersion` row
 * pointing at it (that row rolled back too), so the version history/restore
 * UI can no longer offer it back. That is the CLAUDE.md documents invariant
 * violated from the *other* direction: not "row with no blob", but "row
 * whose blob no longer matches it".
 *
 * The fix captures the just-created archive key as a restore point *before*
 * attempting the overwrite (`archiveContentTx` now returns it) and, on any
 * failure after that point, copies it back over the live key
 * (`revertContentIfWritten`) — mirroring `revertIfRelocated`'s shape but for
 * a destructive overwrite rather than a move.
 */
describe("Documents content overwrite — live blob survives a failure after the write lands (S14c)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageAdapter;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `docs-content-fault-${runId}`;

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
    const data = (await response.json()) as Array<{ id: string; name: string; checksum: string; sizeBytes: number }>;
    expect(response.status).toBe(201);
    return data[0];
  }

  async function replaceContent(workspaceId: string, token: string, id: string, name: string, content: string) {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/plain" }), name);
    return fetch(`${baseUrl}/workspaces/${workspaceId}/documents/${id}/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  }

  async function getContentText(workspaceId: string, token: string, id: string) {
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);
    return response.text();
  }

  async function getDoc(workspaceId: string, token: string, id: string) {
    const list = await request<Array<{ id: string; checksum: string; sizeBytes: number }>>(
      `/workspaces/${workspaceId}/documents?view=active`,
      { method: "GET", token }
    );
    const doc = list.data.find((d) => d.id === id);
    expect(doc).toBeDefined();
    return doc!;
  }

  it("a failed replaceContent (write lands, DB commit fails) leaves the live blob and its DB metadata matching the ORIGINAL content", async () => {
    const alice = await register("alice");
    const originalContent = "original-v1-content";
    const doc = await uploadFile(alice.workspaceId, alice.accessToken, "doc.txt", originalContent);
    const before = await getDoc(alice.workspaceId, alice.accessToken, doc.id);
    expect(before.checksum).toBe(doc.checksum);

    // Let the real write happen (new bytes physically land at the live key),
    // then blow up — the same "server op landed, client throws" fault class
    // already covered for move (WebDAV completes PUT, then the client throws
    // reading the response / a DB hiccup right after).
    const originalPutFile = storage.putFile.bind(storage);
    const putFileSpy = vi.spyOn(storage, "putFile").mockImplementationOnce(async (key, data, meta) => {
      await originalPutFile(key, data, meta);
      throw new Error("injected failure after new content already landed on disk");
    });

    // The compensation restores the live key via `storage.copy` (from the
    // archive `archiveContentTx` just made), not another `putFile` — so it
    // shows up here, not as a second `putFile` call.
    const copySpy = vi.spyOn(storage, "copy");

    const replaced = await replaceContent(alice.workspaceId, alice.accessToken, doc.id, "doc.txt", "replaced-v2-new-content");
    expect(replaced.status).toBeGreaterThanOrEqual(400);
    // Exactly one attempted overwrite (it throws, so there's no successful
    // retry to conflate with a revert here — putFile is only ever used for
    // the overwrite itself, never for reverting).
    expect(putFileSpy).toHaveBeenCalledTimes(1);
    // archiveContentTx's own backup copy, plus the compensation copying that
    // backup back over the live key.
    expect(copySpy).toHaveBeenCalledTimes(2);

    // Live content must still be the ORIGINAL bytes — not the half-applied
    // new upload — and the DB metadata must still describe exactly that.
    expect(await getContentText(alice.workspaceId, alice.accessToken, doc.id)).toBe(originalContent);
    const after = await getDoc(alice.workspaceId, alice.accessToken, doc.id);
    expect(after.checksum).toBe(before.checksum);
    expect(after.sizeBytes).toBe(before.sizeBytes);
  });

  it("a failed restoreVersion (write lands, DB commit fails) leaves the live blob and its DB metadata matching the content from BEFORE the restore attempt", async () => {
    const alice = await register("bob");
    const v1Content = "version-1-content";
    const v2Content = "version-2-content-current";
    const doc = await uploadFile(alice.workspaceId, alice.accessToken, "doc.txt", v1Content);

    // Create version 1 (archives v1Content) by replacing with v2Content — the
    // document's *current* live content is now v2Content, with v1 recorded
    // as DocumentVersion #1.
    const firstReplace = await replaceContent(alice.workspaceId, alice.accessToken, doc.id, "doc.txt", v2Content);
    expect(firstReplace.status).toBeLessThan(300);
    expect(await getContentText(alice.workspaceId, alice.accessToken, doc.id)).toBe(v2Content);

    const versions = await request<Array<{ id: string; versionNumber: number }>>(
      `/workspaces/${alice.workspaceId}/documents/${doc.id}/versions`,
      { method: "GET", token: alice.accessToken }
    );
    expect(versions.data.length).toBe(1);
    const versionId = versions.data[0].id;

    const before = await getDoc(alice.workspaceId, alice.accessToken, doc.id);

    // `restoreVersion` makes THREE `storage.copy` calls in the failing path:
    // (1) archiveContentTx's own backup of the current (v2) live content,
    // (2) the restore-copy itself (v1's bytes overwrite the live key) — this
    // is the one that should throw, after physically landing, and
    // (3) the compensation copying backup (1) back over the live key.
    // Only the 2nd call is the injected fault.
    let copyCall = 0;
    const originalCopy = storage.copy.bind(storage);
    const copySpy = vi.spyOn(storage, "copy").mockImplementation(async (from, to) => {
      copyCall += 1;
      await originalCopy(from, to);
      if (copyCall === 2) throw new Error("injected failure after the restored version's bytes already landed on disk");
    });

    const restore = await request(`/workspaces/${alice.workspaceId}/documents/${doc.id}/versions/${versionId}/restore`, {
      method: "POST",
      token: alice.accessToken
    });
    expect(restore.status).toBeGreaterThanOrEqual(400);
    // Backup copy, the failing restore-copy, and the compensating revert copy.
    expect(copySpy).toHaveBeenCalledTimes(3);

    // Live content must still be v2 (what was live before the failed
    // restore), and the DB metadata must still describe exactly that.
    expect(await getContentText(alice.workspaceId, alice.accessToken, doc.id)).toBe(v2Content);
    const after = await getDoc(alice.workspaceId, alice.accessToken, doc.id);
    expect(after.checksum).toBe(before.checksum);
    expect(after.sizeBytes).toBe(before.sizeBytes);
  });
});
