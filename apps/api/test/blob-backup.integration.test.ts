import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { STORAGE_ADAPTER, type StorageAdapter } from "../src/storage/storage-adapter";
import { collectBlobRefs } from "../src/sync/blob-manifest";
import { decryptSnapshot, encryptSnapshot } from "../src/sync/sync-crypto";
import { WebdavRemote } from "../src/sync/webdav-remote";

// R29 review (29-REVIEW-GRANTS.md, "Детерминизм WebDAV fixture") — `PUT
// .../sync/remote` runs the real `assertPublicRemoteUrl` SSRF guard
// (S05), which does a real `dns.lookup()` on whatever host the fixture
// below uses. A sandbox with no outbound DNS resolution made that lookup
// fail non-deterministically (ENOTFOUND), which the guard correctly turns
// into a 400 — not a bug in the guard, just an undeterministic fixture.
// Mocking `node:dns/promises` (same pattern as
// `remote-url-guard-dns.integration.test.ts`) makes the fixture host
// resolve to a fixed PUBLIC address regardless of sandbox networking,
// without touching or weakening the guard itself — it still runs its own
// real private/loopback-range check against whatever `dns.lookup` returns.
const lookupMock = vi.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

/**
 * S04 (10-BACKLOG.md) — файловые бэкапы и восстановление с recovery.
 *
 * Инвариант: `SyncService.backup()`/`restore()` копируют не только строки
 * БД (S03), но и байты документов, и делают это так, что сбой посередине
 * либо ничего не портит (backup — ничего не уходит на удалёнку, пока весь
 * снапшот+манифест не собран в памяти), либо оставляет уже применённое
 * дерево файлов нетронутым до подтверждённого свопа (restore — staging +
 * атомарный rename, см. `blob-backup.service.ts`).
 *
 * `WebdavRemote` застублен тем же паттерном, что уже использует S02
 * (`api-rls.integration.test.ts`) — никакого реального WebDAV-сервера,
 * шифрование/дешифровка снапшота настоящие. `StorageAdapter` — настоящий
 * `LocalDiskStorage` на `STORAGE_DIR` из `setup-integration.ts`; сбой в
 * него инжектируется через `vi.spyOn` на реальном singleton-инстансе.
 */
describe("file backups and restore with recovery (S04)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageAdapter;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `blob-backup-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  it("S04a: collectBlobRefs derives the same keys the documents module actually writes to", () => {
    // Pure-logic check (no I/O) — same shape as the S03 toposortByParent unit
    // test: prove the key derivation itself is correct before trusting the
    // end-to-end test to catch a mismatch.
    const documents = [
      { id: "folder-1", workspaceId: "ws", kind: "folder" as const, name: "docs", parentId: null, deletedAt: null },
      { id: "file-1", workspaceId: "ws", kind: "file" as const, name: "a.txt", parentId: "folder-1", deletedAt: null },
      { id: "file-2", workspaceId: "ws", kind: "file" as const, name: "b.txt", parentId: null, deletedAt: new Date() }
    ];
    const refs = collectBlobRefs(documents, []);
    expect(refs.map((r) => r.key)).toEqual(["ws/docs/a.txt", "ws/.trash/file-2"]);
  });

  it("S04b: backup embeds file bytes with a checksum computed from the actual bytes, and restore writes them back verified", async () => {
    const alice = await register("alice");
    const original = "hello, восстанавливаемый файл v1";
    const uploaded = await uploadFile(alice, "report.txt", original);
    expect(uploaded.status).toBe(201);
    const docId = uploaded.data[0].id;

    await putRemote(alice);
    const capture = stubWebdav();
    try {
      const backup = await request(`/workspaces/${alice.workspaceId}/sync/backup`, {
        method: "POST",
        token: alice.accessToken
      });
      expect(backup.status).toBe(201);
      expect(capture.sealedLatest).not.toBeNull();

      const payload = JSON.parse(decryptSnapshot(capture.sealedLatest!).toString("utf8")) as {
        blobs: Array<{ key: string; sha256: string; size: number; data: string }>;
      };
      const expectedSha = createHash("sha256").update(Buffer.from(original, "utf8")).digest("hex");
      const entry = payload.blobs.find((b) => b.key.endsWith("report.txt"));
      expect(entry).toBeDefined();
      expect(entry!.sha256).toBe(expectedSha);
      expect(Buffer.from(entry!.data, "base64").toString("utf8")).toBe(original);

      // Drift the workspace: overwrite the file's live content, so restore
      // has to actually write bytes back, not just no-op on already-correct
      // storage.
      await replaceContent(alice, docId, "содержимое после бэкапа, должно быть заменено restore'ом");

      const manifestHash = await previewHash(alice);
      const apply = await request<{ applied: boolean }>(`/workspaces/${alice.workspaceId}/sync/restore`, {
        method: "POST",
        token: alice.accessToken,
        body: { dryRun: false, confirmWorkspaceId: alice.workspaceId, expectedManifestHash: manifestHash }
      });
      expect(apply.status).toBe(201);
      expect(apply.data.applied).toBe(true);

      const content = await fetchContent(alice, docId);
      expect(content).toBe(original);
    } finally {
      capture.restore();
    }
  });

  it("S04c: a fault after the FIRST of two files is staged during restore leaves BOTH old files untouched, and a retry self-heals via recover()", async () => {
    const bob = await register("bob");
    const originalA = "версия A сохранённая бэкапом";
    const originalB = "версия B сохранённая бэкапом";
    const uploadedA = await uploadFile(bob, "a.txt", originalA);
    const uploadedB = await uploadFile(bob, "b.txt", originalB);
    const docA = uploadedA.data[0].id;
    const docB = uploadedB.data[0].id;

    await putRemote(bob);
    const capture = stubWebdav();
    try {
      const backup = await request(`/workspaces/${bob.workspaceId}/sync/backup`, {
        method: "POST",
        token: bob.accessToken
      });
      expect(backup.status).toBe(201);

      const driftedA = "живой A после бэкапа — не должен пережить неудавшийся restore";
      const driftedB = "живой B после бэкапа — не должен пережить неудавшийся restore";
      await replaceContent(bob, docA, driftedA);
      await replaceContent(bob, docB, driftedB);

      // Fault injection: let the real StorageAdapter singleton's putFile
      // succeed for the journal's initial write AND the first blob (proving
      // partial staging is possible), then throw before the second blob is
      // staged — a genuine "interrupted in the middle" fault, not just an
      // instant one.
      const manifestHash = await previewHash(bob);
      let calls = 0;
      const originalPutFile = storage.putFile.bind(storage);
      const putFileSpy = vi.spyOn(storage, "putFile").mockImplementation(async (key, data, meta) => {
        calls += 1;
        if (calls === 3) throw new Error("injected fault: disk full mid-staging");
        return originalPutFile(key, data, meta);
      });

      const failedApply = await request(`/workspaces/${bob.workspaceId}/sync/restore`, {
        method: "POST",
        token: bob.accessToken,
        body: { dryRun: false, confirmWorkspaceId: bob.workspaceId, expectedManifestHash: manifestHash }
      });
      // The controller has no explicit error mapping for this — a thrown
      // Error becomes Nest's default 500. What matters for data integrity is
      // not the status code but that storage was not touched.
      expect(failedApply.status).toBeGreaterThanOrEqual(500);
      expect(calls).toBe(3);
      putFileSpy.mockRestore();

      // Old bytes must still be exactly what they were before the aborted
      // restore attempt for BOTH files — proof the swap never ran, even
      // though one of the two blobs did make it into the (orphaned) staging
      // area before the fault.
      expect(await fetchContent(bob, docA)).toBe(driftedA);
      expect(await fetchContent(bob, docB)).toBe(driftedB);

      // Retrying restore must self-heal: `SyncService.restore` calls
      // `BlobBackupService.recover()` before every apply, so the orphaned
      // staging directory from the failed attempt above doesn't block this
      // one, and the retry completes normally.
      // The remote snapshot content itself hasn't changed since the manifestHash
      // above was computed (only local disk state — the failed staging attempt
      // and its recovery — changed), so the same hash is still valid on retry.
      const retried = await request<{ applied: boolean }>(`/workspaces/${bob.workspaceId}/sync/restore`, {
        method: "POST",
        token: bob.accessToken,
        body: { dryRun: false, confirmWorkspaceId: bob.workspaceId, expectedManifestHash: manifestHash }
      });
      expect(retried.status).toBe(201);
      expect(retried.data.applied).toBe(true);
      expect(await fetchContent(bob, docA)).toBe(originalA);
      expect(await fetchContent(bob, docB)).toBe(originalB);
    } finally {
      capture.restore();
    }
  });

  it("S04e: apply rejects a stale preview — the remote snapshot changed after preview, before apply", async () => {
    const dave = await register("dave");
    const originalContent = "версия 1 — та, что видел preview";
    const uploaded = await uploadFile(dave, "plan.txt", originalContent);
    const docId = uploaded.data[0].id;

    await putRemote(dave);
    const capture = stubWebdav();
    try {
      // First backup — this is what the preview below will see.
      const firstBackup = await request(`/workspaces/${dave.workspaceId}/sync/backup`, {
        method: "POST",
        token: dave.accessToken
      });
      expect(firstBackup.status).toBe(201);

      const preview = await request<{ manifestHash: string }>(`/workspaces/${dave.workspaceId}/sync/restore`, {
        method: "POST",
        token: dave.accessToken,
        body: { dryRun: true }
      });
      expect(preview.status).toBe(201);
      expect(typeof preview.data.manifestHash).toBe("string");
      expect(preview.data.manifestHash.length).toBeGreaterThan(0);

      // Simulate a second client backing up again between this preview and
      // the apply call below — the remote's latest.orion now differs from
      // what preview saw, even though the workspace itself wasn't touched
      // through this session.
      await replaceContent(dave, docId, "версия 2 — другой клиент успел сделать новый бэкап");
      const secondBackup = await request(`/workspaces/${dave.workspaceId}/sync/backup`, {
        method: "POST",
        token: dave.accessToken
      });
      expect(secondBackup.status).toBe(201);

      // Apply using the STALE manifestHash from the first preview must be
      // rejected — not silently apply the second (unseen) plan as if it were
      // the first.
      const staleApply = await request(`/workspaces/${dave.workspaceId}/sync/restore`, {
        method: "POST",
        token: dave.accessToken,
        body: {
          dryRun: false,
          confirmWorkspaceId: dave.workspaceId,
          expectedManifestHash: preview.data.manifestHash
        }
      });
      expect(staleApply.status).toBe(400);

      // The workspace must be untouched by the rejected apply — still on the
      // v2 content it had before the stale apply attempt (not rolled back to
      // v1, since nothing should have been applied at all).
      expect(await fetchContent(dave, docId)).toBe("версия 2 — другой клиент успел сделать новый бэкап");

      // Sanity: dryRun: false with NO expectedManifestHash at all is also
      // rejected (can't silently skip the check either).
      const missingHash = await request(`/workspaces/${dave.workspaceId}/sync/restore`, {
        method: "POST",
        token: dave.accessToken,
        body: { dryRun: false, confirmWorkspaceId: dave.workspaceId }
      });
      expect(missingHash.status).toBe(400);

      // A fresh preview + apply with the CURRENT hash still works normally.
      const freshPreview = await request<{ manifestHash: string }>(`/workspaces/${dave.workspaceId}/sync/restore`, {
        method: "POST",
        token: dave.accessToken,
        body: { dryRun: true }
      });
      expect(freshPreview.status).toBe(201);
      const freshApply = await request<{ applied: boolean }>(`/workspaces/${dave.workspaceId}/sync/restore`, {
        method: "POST",
        token: dave.accessToken,
        body: {
          dryRun: false,
          confirmWorkspaceId: dave.workspaceId,
          expectedManifestHash: freshPreview.data.manifestHash
        }
      });
      expect(freshApply.status).toBe(201);
      expect(freshApply.data.applied).toBe(true);
    } finally {
      capture.restore();
    }
  });

  it("S04d: a pre-S04 backup (no embedded blobs) is rejected fail-closed on restore, not silently applied without file bytes", async () => {
    const carol = await register("carol");
    await putRemote(carol);
    const capture = stubWebdav();
    try {
      // Simulate a backup taken before S04: the raw WorkspaceSnapshot object,
      // no `{ blobs, snapshot }` wrapper.
      const legacyPayload = {
        version: 2,
        workspaceId: carol.workspaceId,
        generatedAt: new Date().toISOString(),
        tables: {},
        workspaceConfig: { disabledModules: [], pluginOverrides: [], restrictedModules: [] }
      };
      capture.sealedLatest = encryptSnapshot(Buffer.from(JSON.stringify(legacyPayload), "utf8"));

      const preview = await request(`/workspaces/${carol.workspaceId}/sync/restore`, {
        method: "POST",
        token: carol.accessToken,
        body: { dryRun: true }
      });
      expect(preview.status).toBe(400);
    } finally {
      capture.restore();
    }
  });

  // --- helpers ---------------------------------------------------------

  interface Actor {
    workspaceId: string;
    userId: string;
    accessToken: string;
  }

  async function register(name: string): Promise<Actor> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "integration-password-123", name })
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { accessToken: string; user: { id: string } };
    const workspacesResponse = await fetch(`${baseUrl}/workspaces/me`, {
      headers: { Authorization: `Bearer ${data.accessToken}` }
    });
    const workspaces = (await workspacesResponse.json()) as Array<{ id: string }>;
    expect(workspaces).toHaveLength(1);
    return { workspaceId: workspaces[0].id, userId: data.user.id, accessToken: data.accessToken };
  }

  async function uploadFile(
    actor: Actor,
    name: string,
    content: string
  ): Promise<{ status: number; data: Array<{ id: string }> }> {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/plain" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${actor.workspaceId}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      body: form
    });
    return { status: response.status, data: (await response.json()) as Array<{ id: string }> };
  }

  async function replaceContent(actor: Actor, id: string, content: string): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/plain" }), "unused.txt");
    const response = await fetch(`${baseUrl}/workspaces/${actor.workspaceId}/documents/${id}/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      body: form
    });
    expect(response.status).toBe(201);
  }

  async function fetchContent(actor: Actor, id: string): Promise<string> {
    const response = await fetch(`${baseUrl}/workspaces/${actor.workspaceId}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${actor.accessToken}` }
    });
    expect(response.status).toBe(200);
    return response.text();
  }

  /** Runs a dryRun preview and returns its `manifestHash`, for the realistic
   *  client flow apply() now requires (S04, stale-preview rejection). */
  async function previewHash(actor: Actor): Promise<string> {
    const preview = await request<{ manifestHash: string }>(`/workspaces/${actor.workspaceId}/sync/restore`, {
      method: "POST",
      token: actor.accessToken,
      body: { dryRun: true }
    });
    expect(preview.status).toBe(201);
    return preview.data.manifestHash;
  }

  async function putRemote(actor: Actor): Promise<void> {
    const res = await request(`/workspaces/${actor.workspaceId}/sync/remote`, {
      method: "PUT",
      token: actor.accessToken,
      body: {
        kind: "webdav",
        url: "https://example.com/dav",
        username: "u",
        password: "p",
        baseDir: "/ORION",
        depthInfinity: true,
        encAlgo: "rclone-base64",
        autoEveryMs: -1
      }
    });
    expect(res.status).toBe(200);
  }

  /**
   * Same stubbing pattern as S02: captures whatever backup() uploads as
   * `latest.orion` and hands it back to restore(). Returns the mutable
   * capture object directly (not a getter/setter wrapper) so a test can also
   * pre-seed `capture.sealedLatest` itself (S04d, simulating a legacy file).
   */
  function stubWebdav(): { sealedLatest: Buffer | null; restore: () => void } {
    const capture: { sealedLatest: Buffer | null; restore: () => void } = {
      sealedLatest: null,
      restore: () => {}
    };
    const spies = [
      vi.spyOn(WebdavRemote.prototype, "ensureDir").mockResolvedValue(undefined),
      vi.spyOn(WebdavRemote.prototype, "putFile").mockImplementation(async (rel: string, data: Buffer) => {
        if (rel.endsWith("latest.orion")) capture.sealedLatest = data;
      }),
      vi.spyOn(WebdavRemote.prototype, "exists").mockResolvedValue(true),
      vi.spyOn(WebdavRemote.prototype, "getFile").mockImplementation(async () => {
        if (!capture.sealedLatest) throw new Error("test setup bug: no backup captured yet");
        return capture.sealedLatest;
      })
    ];
    capture.restore = () => spies.forEach((s) => s.mockRestore());
    return capture;
  }

  async function request<T = unknown>(
    path: string,
    opts: { method?: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T };
  }
});
