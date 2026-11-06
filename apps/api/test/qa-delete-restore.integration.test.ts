import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

describe("QA-03: deletion isolation and recoverability", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let origin: string;
  const prefix = "gptqa-delete-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  let serial = 0;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    origin = "http://127.0.0.1:" + (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    try {
      if (prisma) await prisma.asSystem(async tx => {
        const users = await tx.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
        const ids = users.map(u => u.id);
        if (!ids.length) return;
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: ids } }, select: { workspaceId: true }
        });
        const wsIds = [...new Set(memberships.map(m => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: wsIds } } });
      });
    } finally { await app?.close(); }
  });

  async function http<T = any>(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }
  async function owner() {
    const auth = await http<{ accessToken: string }>("POST", "/auth/register", undefined, {
      email: prefix + "-" + serial++ + "@example.test", name: "QA Owner", password: "integration-password-123"
    });
    expect(auth.status).toBe(201);
    const token = auth.data.accessToken;
    const ws = (await http<Array<{ id: string }>>("GET", "/workspaces/me", token)).data[0]!.id;
    return {
      ws,
      call: <T = any>(method: string, path: string, body?: unknown) =>
        http<T>(method, "/workspaces/" + ws + path, token, body)
    };
  }

  it("QA-03-01: deleting one note never removes another; trash and restore preserve the same identity and content", async () => {
    const s = await owner();
    const a = await s.call<{ id: string }>("POST", "/notes", { title: "Удалить A", body: "A-v1" });
    const b = await s.call<{ id: string }>("POST", "/notes", { title: "Оставить B", body: "B-v1" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await s.call("DELETE", "/notes/" + a.data.id)).status).toBe(200);
    const active = await s.call<Array<{ id: string }>>("GET", "/notes");
    const trash = await s.call<Array<{ id: string }>>("GET", "/notes?view=trash");
    expect(active.data.some(n => n.id === a.data.id)).toBe(false);
    expect(active.data.some(n => n.id === b.data.id)).toBe(true);
    expect(trash.data.some(n => n.id === a.data.id)).toBe(true);
    const restored = await s.call<{ id: string; body: string }>("POST", "/notes/" + a.data.id + "/restore");
    expect(restored.status).toBe(201);
    expect(restored.data).toMatchObject({ id: a.data.id, body: "A-v1" });
    const other = await s.call<{ id: string; body: string }>("GET", "/notes/" + b.data.id);
    expect(other.data).toMatchObject({ id: b.data.id, body: "B-v1" });
  });

  it("QA-03-02: a different workspace cannot trash or restore the owner's note", async () => {
    const ownerA = await owner(), ownerB = await owner();
    const note = await ownerA.call<{ id: string }>("POST", "/notes", { title: "Частная A", body: "Не трогать" });
    expect(note.status).toBe(201);
    const denied = await ownerB.call("DELETE", "/notes/" + note.data.id);
    expect([403, 404]).toContain(denied.status);
    const restoreDenied = await ownerB.call("POST", "/notes/" + note.data.id + "/restore");
    expect([403, 404]).toContain(restoreDenied.status);
    expect((await ownerA.call<{ body: string }>("GET", "/notes/" + note.data.id)).data.body).toBe("Не трогать");
  });

  it("QA-03-03 RED CONTRACT: a deleted task can be restored with the original id", async () => {
    const s = await owner();
    const task = await s.call<{ id: string }>("POST", "/tasks", { title: "Вернуть после удаления" });
    expect(task.status).toBe(201);
    expect((await s.call("DELETE", "/tasks/" + task.data.id)).status).toBe(200);
    const afterDelete = await s.call<Array<{ id: string }>>("GET", "/tasks");
    expect(afterDelete.data.some(row => row.id === task.data.id)).toBe(false);
    // No such route exists on beta37: this red assertion captures the
    // product requirement, rather than silently accepting permanent loss.
    const restore = await s.call("POST", "/tasks/" + task.data.id + "/restore");
    expect([200, 201]).toContain(restore.status);
    const afterRestore = await s.call<Array<{ id: string; title: string }>>("GET", "/tasks");
    expect(afterRestore.data.find(row => row.id === task.data.id))
      .toMatchObject({ id: task.data.id, title: "Вернуть после удаления" });
  });
});
