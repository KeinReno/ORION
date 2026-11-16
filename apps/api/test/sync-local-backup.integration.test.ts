import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Локальный бэкап: `GET /sync/local-export` отдаёт тот же зашифрованный
 * `.orion`, что уходит в облако (строки снапшота + байты документов), а
 * `POST /sync/local-restore/preview|apply` прогоняет файл через тот же
 * конвейер восстановления, включая stale-preview rejection
 * (`expectedManifestHash`). Owner-only, как и облачный бэкап.
 */
describe("Sync local backup (export/import file)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `sync-local-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string) {
    const email = `${emailPrefix}-${name}@example.test`;
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    return { token, email, userId: registered.data.user.id, workspaceId };
  }

  /** Anya owns the workspace, Petya is a plain member. */
  async function pair(name: string) {
    const anya = await register(`${name}-anya`);
    const petya = await register(`${name}-petya`);
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${anya.workspaceId}/invites`, { method: "POST", token: anya.token, body: { email: petya.email } });
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, { method: "POST", token: petya.token })).status).toBe(201);
    return { anya, petya, workspaceId: anya.workspaceId, ws: `/workspaces/${anya.workspaceId}/sync` };
  }

  async function exportBackup(token: string, ws: string): Promise<{ status: number; disposition: string | null; bytes: Buffer }> {
    const response = await fetch(`${baseUrl}${ws}/local-export`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      bytes: Buffer.from(await response.arrayBuffer())
    };
  }

  function backupForm(bytes: Buffer, fileName: string, fields: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.append("file", new Blob([bytes]), fileName);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  }

  async function postForm<T = unknown>(token: string, path: string, form: FormData): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  type Note = { id: string; title: string };
  type Preview = {
    snapshot: string;
    createdAt: string;
    incoming: Record<string, number>;
    current: Record<string, number>;
    applied: boolean;
    manifestHash: string;
  };

  it("owner exports a local backup file; member gets 403", async () => {
    const { anya, petya, ws } = await pair("export");
    const exported = await exportBackup(anya.token, ws);
    expect(exported.status).toBe(200);
    expect(exported.disposition).toContain("attachment");
    expect(exported.disposition).toMatch(/\.orion"/);
    expect(exported.bytes.length).toBeGreaterThan(100);
    expect((await exportBackup(petya.token, ws)).status).toBe(403);
  });

  it("restores the workspace from a local file and rejects a stale preview hash", async () => {
    const { anya, ws, workspaceId } = await pair("restore");
    const note = await request<Note>(`/workspaces/${workspaceId}/notes`, {
      method: "POST",
      token: anya.token,
      body: { title: "Важное", body: "не потерять" }
    });
    expect(note.status).toBe(201);

    const exported = await exportBackup(anya.token, ws);
    expect(exported.status).toBe(200);

    // Удалили единственную заметку — восстановление из файла должно её вернуть.
    expect((await request(`/workspaces/${workspaceId}/notes/${note.data.id}`, { method: "DELETE", token: anya.token })).status).toBeLessThan(300);
    const empty = await request<Note[]>(`/workspaces/${workspaceId}/notes`, { method: "GET", token: anya.token });
    expect(empty.data.find((n) => n.id === note.data.id)).toBeUndefined();

    const preview = await postForm<Preview>(anya.token, `${ws}/local-restore/preview`, backupForm(exported.bytes, "copy.orion"));
    expect(preview.status).toBe(201);
    expect(preview.data.applied).toBe(false);
    expect(preview.data.snapshot).toBe("copy.orion");
    expect(preview.data.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.data.incoming.notes).toBeGreaterThan(0);

    // Чужой/устаревший hash — отказ (stale-preview rejection, тот же контракт, что у облака).
    const stale = await postForm(anya.token, `${ws}/local-restore/apply`, backupForm(exported.bytes, "copy.orion", {
      confirmWorkspaceId: workspaceId,
      expectedManifestHash: "0".repeat(64)
    }));
    expect(stale.status).toBe(400);

    const applied = await postForm<Preview>(anya.token, `${ws}/local-restore/apply`, backupForm(exported.bytes, "copy.orion", {
      confirmWorkspaceId: workspaceId,
      expectedManifestHash: preview.data.manifestHash
    }));
    expect(applied.status).toBe(201);
    expect(applied.data.applied).toBe(true);

    const restored = await request<Note[]>(`/workspaces/${workspaceId}/notes`, { method: "GET", token: anya.token });
    expect(restored.data.find((n) => n.id === note.data.id)?.title).toBe("Важное");
  });

  it("rejects a file that is not a backup and refuses members", async () => {
    const { anya, petya, ws } = await pair("garbage");
    const garbage = await postForm(anya.token, `${ws}/local-restore/preview`, backupForm(Buffer.from("definitely not a backup"), "x.orion"));
    expect(garbage.status).toBe(400);

    const exported = await exportBackup(anya.token, ws);
    expect((await postForm(petya.token, `${ws}/local-restore/preview`, backupForm(exported.bytes, "x.orion"))).status).toBe(403);

    const noFile = await fetch(`${baseUrl}${ws}/local-restore/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${anya.token}`, "Content-Type": "multipart/form-data" }
    });
    expect(noFile.status).toBe(400);
  });
});
