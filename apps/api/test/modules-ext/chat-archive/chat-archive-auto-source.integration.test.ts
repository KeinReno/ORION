import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { ChatArchiveDiscoveryService } from "../../../src/modules-ext/chat-archive/chat-archive-discovery.service";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";

/**
 * ORION-16 — тумблер автосбора (opt-in, выключен по умолчанию) и сам сканер
 * (`ChatArchiveDiscoveryService`): здесь в точности то, что реально сканируется и
 * импортируется, в отличие от `chat-archive-discovery.service.test.ts` (там только
 * чистые хелперы batching/completeLines).
 */
describe("Архив чатов — автосбор (ORION-16)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let discovery: ChatArchiveDiscoveryService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `chat-archive-auto-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    discovery = app.get(ChatArchiveDiscoveryService);
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
        const orphans = await tx.chatArchiveAutoSource.count({ where: { workspaceId: { in: workspaceIds } } });
        if (orphans > 0) throw new Error(`Cleanup left ${orphans} chat_archive_auto_sources row(s) behind`);
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

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${counter++}@example.test`, password: "integration-password-123", name: "Участник" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    return { token, ws, userId: response.data.user.id };
  }

  it("is off by default for both known sources, and a toggle only flips the one it names", async () => {
    const { token, ws } = await setup();
    const initial = await request(`/workspaces/${ws}/chat-archive/auto-sources`, { method: "GET", token });
    expect(initial.data).toEqual([
      { source: "claude-code", enabled: false, lastScanAt: null },
      { source: "codex", enabled: false, lastScanAt: null }
    ]);

    const on = await request(`/workspaces/${ws}/chat-archive/auto-sources`, { method: "PUT", token, body: { source: "claude-code", enabled: true } });
    expect(on.status, JSON.stringify(on.data)).toBe(200);
    expect(on.data).toMatchObject({ source: "claude-code", enabled: true });

    const after = await request(`/workspaces/${ws}/chat-archive/auto-sources`, { method: "GET", token });
    expect(after.data).toEqual([
      { source: "claude-code", enabled: true, lastScanAt: null },
      { source: "codex", enabled: false, lastScanAt: null }
    ]);

    // Выключаем обратно — иначе этот ряд останется enabled и попадёт в системный скан следующего теста.
    await request(`/workspaces/${ws}/chat-archive/auto-sources`, { method: "PUT", token, body: { source: "claude-code", enabled: false } });
  });

  it("scans only what's enabled, imports it, never re-imports unchanged files, and keeps history after disabling (AC1/AC3)", async () => {
    const { ws, userId } = await setup();
    const home = mkdtempSync(join(tmpdir(), "orion-chat-archive-home-"));
    const projectDir = join(home, ".claude", "projects", "demo");
    mkdirSync(projectDir, { recursive: true });
    const sessionFile = join(projectDir, "sess-auto.jsonl");
    const line1 = JSON.stringify({ type: "user", sessionId: "auto-1", cwd: "C:\\demo", timestamp: "2026-10-28T10:00:00.000Z", message: { role: "user", content: "Привет, автосбор" } });
    writeFileSync(sessionFile, `${line1}\n`);

    await prisma.asSystem((tx) => tx.chatArchiveAutoSource.create({ data: { workspaceId: ws, userId, source: "claude-code", enabled: true } }));

    const savedHome = process.env.USERPROFILE;
    const savedHomeUnix = process.env.HOME;
    try {
      process.env.USERPROFILE = home;
      process.env.HOME = home;

      const first = await discovery.runAll();
      expect(first.scanned).toBeGreaterThanOrEqual(1);
      expect(first.appended).toBe(1);

      const conversations = await prisma.withUser(userId, (tx) => tx.chatArchiveConversation.findMany({ where: { workspaceId: ws, externalId: "auto-1" } }));
      expect(conversations).toHaveLength(1);
      expect(conversations[0]).toMatchObject({ source: "claude-code", projectPath: "C:\\demo", lineCount: 1 });

      // Второй проход того же неизменённого файла ничего не добавляет (mtime <= lastScanAt).
      const second = await discovery.runAll();
      expect(second.appended).toBe(0);

      // Дописали строку — следующий проход подхватывает только хвост.
      const line2 = JSON.stringify({ type: "assistant", sessionId: "auto-1", timestamp: "2026-10-28T10:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Поймал" }] } });
      writeFileSync(sessionFile, `${line1}\n${line2}\n`);
      // На Windows mtime файла может совпасть с lastScanAt предыдущего прохода
      // (разрешение часов / округление). Ставим время явно позже скана.
      const newer = new Date(Date.now() + 5_000);
      utimesSync(sessionFile, newer, newer);
      const third = await discovery.runAll();
      expect(third.appended).toBe(1);

      // Выключили источник: следующий проход его не трогает вовсе.
      await prisma.asSystem((tx) => tx.chatArchiveAutoSource.updateMany({ where: { workspaceId: ws, userId, source: "claude-code" }, data: { enabled: false } }));
      const line3 = JSON.stringify({ type: "user", sessionId: "auto-1", timestamp: "2026-10-28T10:02:00.000Z", message: { role: "user", content: "Это не должно попасть в архив" } });
      writeFileSync(sessionFile, `${line1}\n${line2}\n${line3}\n`);
      const newerStill = new Date(Date.now() + 10_000);
      utimesSync(sessionFile, newerStill, newerStill);
      const fourth = await discovery.runAll();
      expect(fourth.scanned).toBe(0);

      // История, собранная до выключения, осталась (AC3) — выключение не чистит архив.
      const stillThere = await prisma.withUser(userId, (tx) => tx.chatArchiveConversation.findMany({ where: { workspaceId: ws, externalId: "auto-1" } }));
      expect(stillThere).toHaveLength(1);
      expect(stillThere[0]!.lineCount).toBe(2); // третья строка не вошла — источник был выключен
    } finally {
      process.env.USERPROFILE = savedHome;
      process.env.HOME = savedHomeUnix;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
