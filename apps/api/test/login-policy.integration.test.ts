import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Политика входа хоста LAN (ADR-0015, дополнение): «домашняя» — PIN, список аккаунтов, пароль от 8 символов и блокировка
 * аккаунта после серии неверных попыток; «строгая» — как у сервера. Режим и политика читаются на каждый запрос, поэтому один
 * запущенный сервер переключаем переменными окружения и файлом узла.
 */
describe("Login policy of a LAN host", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let nodeDir: string;
  const emailPrefix = `login-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-policy-"));
  });

  afterEach(() => {
    delete process.env.ORION_MODE;
    delete process.env.ORION_LAN_HOST;
    delete process.env.ORION_NODE_DIR;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { OR: [{ email: { startsWith: emailPrefix } }, { name: { startsWith: emailPrefix } }] }, select: { id: true } });
        const ids = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      });
    }
    await app?.close();
    fs.rmSync(nodeDir, { recursive: true, force: true });
  });

  async function request<T = any>(path: string, method: string, body?: unknown, token?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  /** Включает серверный режим с хостом LAN и политикой (`home` / `strict`) на время теста. */
  function asHost(loginPolicy: "home" | "strict"): void {
    fs.writeFileSync(path.join(nodeDir, "lan-node.json"), JSON.stringify({ nodeId: "n1", name: "Тест", mode: "host", port: 4443, ownerUserId: null, loginPolicy }));
    process.env.ORION_MODE = "server";
    process.env.ORION_LAN_HOST = "1";
    process.env.ORION_NODE_DIR = nodeDir;
  }

  /** Вход напрямую через сервис: общий лимит запросов по IP (10 за 5 минут) не должен мешать проверять блокировку аккаунта. */
  async function tryLogin(input: { userId: string; pin: string }): Promise<{ status: number; message: string }> {
    try {
      await app.get(AuthService).login(input);
      return { status: 201, message: "" };
    } catch (error) {
      const e = error as { getStatus?: () => number; message?: string };
      return { status: e.getStatus?.() ?? 500, message: e.message ?? "" };
    }
  }

  let counter = 0;
  const name = () => `${emailPrefix}-${counter++}`;

  it("чистый старт: профиль без почты и автопространства; своё пустое личное пространство создаётся отдельно", async () => {
    const created = await request<{ accessToken: string; user: { id: string } }>("/auth/register", "POST", {
      name: name(), pin: "4821", createPersonalWorkspace: false
    });
    expect(created.status).toBe(201);
    const token = created.data.accessToken;
    expect((await request("/workspaces/me", "GET", undefined, token)).data).toEqual([]);
    const space = await request<{ id: string; name: string; isPersonal: boolean }>("/workspaces", "POST", {
      name: "Моё пространство", isPersonal: true
    }, token);
    expect(space.status).toBe(201);
    expect(space.data).toMatchObject({ name: "Моё пространство", isPersonal: true });
    const counts = await prisma.asSystem(async (tx) => ({
      projects: await tx.project.count({ where: { workspaceId: space.data.id } }),
      tasks: await tx.task.count({ where: { workspaceId: space.data.id } }),
      notes: await tx.note.count({ where: { workspaceId: space.data.id } })
    }));
    expect(counts).toEqual({ projects: 0, tasks: 0, notes: 0 });
    expect((await request("/auth/login", "POST", { userId: created.data.user.id, pin: "4821" })).status).toBe(201);
  });

  it("/system/mode сообщает политику: local в «Локальном», home и strict на хосте, strict на обычном сервере", async () => {
    expect((await request("/system/mode", "GET")).data).toEqual({ mode: "local", loginPolicy: "local" });
    asHost("home");
    expect((await request("/system/mode", "GET")).data).toEqual({ mode: "server", loginPolicy: "home" });
    asHost("strict");
    expect((await request("/system/mode", "GET")).data).toEqual({ mode: "server", loginPolicy: "strict" });
    delete process.env.ORION_LAN_HOST;
    expect((await request("/system/mode", "GET")).data.loginPolicy).toBe("strict");
  });

  it("домашняя политика: PIN, список аккаунтов и пароль от 8 символов разрешены", async () => {
    asHost("home");
    const pinName = name();
    const pinUser = await request("/auth/register", "POST", { name: pinName, pin: "4821" });
    expect(pinUser.status).toBe(201);
    expect((await request("/auth/register", "POST", { name: name(), email: `${name()}@example.test`, password: "kotik123" })).status).toBe(201);
    expect((await request("/auth/register", "POST", { name: name(), email: `${name()}@example.test`, password: "short" })).status).toBe(400);

    const accounts = await request<Array<{ name: string }>>("/auth/accounts", "GET");
    expect(accounts.status).toBe(200);
    expect(accounts.data.some((account) => account.name === pinName)).toBe(true);
    const id = pinUser.data.user.id as string;
    expect((await request("/auth/login", "POST", { userId: id, pin: "4821" })).status).toBe(201);
  });

  it("домашняя политика: после 5 неверных PIN аккаунт блокируется, даже верный PIN не пускает, другой аккаунт не страдает", async () => {
    asHost("home");
    const victim = await request("/auth/register", "POST", { name: name(), pin: "1357" });
    const other = await request("/auth/register", "POST", { name: name(), pin: "2468" });
    const id = victim.data.user.id as string;
    for (let i = 0; i < 5; i++) expect((await tryLogin({ userId: id, pin: "0000" })).status).toBe(401);
    const locked = await tryLogin({ userId: id, pin: "1357" });
    expect(locked.status).toBe(429);
    expect(locked.message).toContain("Подождите");
    expect((await tryLogin({ userId: other.data.user.id as string, pin: "2468" })).status).toBe(201);
  });

  it("строгая политика: PIN, список аккаунтов и короткий пароль запрещены, как у сервера", async () => {
    asHost("strict");
    expect((await request("/auth/register", "POST", { name: name(), pin: "4821" })).status).toBe(400);
    expect((await request("/auth/register", "POST", { name: name(), email: `${name()}@example.test`, password: "kotik123" })).status).toBe(400);
    expect((await request("/auth/accounts", "GET")).status).toBe(403);
    expect((await request("/auth/login", "POST", { userId: "x", pin: "1234" })).status).toBe(400);
  });

  it("«Локальный» режим не меняется: PIN и список аккаунтов работают, блокировки нет", async () => {
    const local = await request("/auth/register", "POST", { name: name(), pin: "9753" });
    expect(local.status).toBe(201);
    for (let i = 0; i < 7; i++) expect((await tryLogin({ userId: local.data.user.id as string, pin: "0000" })).status).toBe(401);
    expect((await tryLogin({ userId: local.data.user.id as string, pin: "9753" })).status).toBe(201);
  });
});
