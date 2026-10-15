import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * ТЗ-04. Пока режим «Хост LAN» не применён к процессу, узел ничего не раздаёт в сеть и не притворяется хостом:
 * визитка и заявки — 404, прокси клиента — 409, управление — только с JWT. Включение хоста не должно молча менять
 * чужие аккаунты: без паролей для PIN-аккаунтов оно отклоняется целиком (ничего не записывается).
 * (Проверка «чужой по сети без device-токена получает 403» — юнит-тест device-trust.middleware: из интеграционного
 * теста все запросы приходят с loopback.)
 */
describe("LAN host/client — inactive node and enable guard", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let nodeDir: string;
  const emailPrefix = `lan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-lan-it-"));
    process.env.ORION_NODE_DIR = nodeDir;
    delete process.env.ORION_LAN_HOST;
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
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
      });
    }
    await app?.close();
    delete process.env.ORION_NODE_DIR;
    fs.rmSync(nodeDir, { recursive: true, force: true });
  });

  async function request<T = unknown>(path_: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
    const address = app.getHttpServer().address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}${path_}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  it("shows no node card, takes no pair requests, and proxies nowhere while not a host/client", async () => {
    expect((await request("/lan/info")).status).toBe(404);
    expect((await request("/lan/pair/request", { method: "POST", body: { deviceName: "X", clientNonce: "n".repeat(24) } })).status).toBe(404);
    expect((await request("/lan/pair/status/abc")).status).toBe(404);
    const proxied = await request<{ code: string }>("/_remote/workspaces");
    expect(proxied.status).toBe(409);
    expect(proxied.data.code).toBe("not_client_mode");
    const status = await request<{ mode: string; link: string; apiPath: string }>("/lan/client/status");
    expect(status.data).toMatchObject({ mode: "local", link: "none", apiPath: "" });
  });

  it("requires a login for host management", async () => {
    for (const [method, route] of [["GET", "/lan/host"], ["GET", "/lan/host/devices"], ["POST", "/lan/host/enable"], ["GET", "/lan/host/pairs"]] as const) {
      expect((await request(route, { method })).status, route).toBe(401);
    }
  });

  it("refuses to enable the host while a PIN account has no password, and changes nothing", async () => {
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-pin@example.test`, pin: "4821", name: "Pin user" }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;

    const accounts = await request<Array<{ userId: string }>>("/lan/host/pin-accounts", { token });
    expect(accounts.data.map((item) => item.userId)).toContain(registered.data.user.id);

    const refused = await request<{ code: string; accounts: Array<{ userId: string }> }>("/lan/host/enable", { method: "POST", token, body: { acknowledged: true } });
    expect(refused.status).toBe(409);
    expect(refused.data.code).toBe("accounts_need_password");
    expect(refused.data.accounts.map((item) => item.userId)).toContain(registered.data.user.id);

    const notAcknowledged = await request("/lan/host/enable", { method: "POST", token, body: {} });
    expect(notAcknowledged.status).toBe(400);

    const host = await request<{ mode: string; active: boolean }>("/lan/host", { token });
    expect(host.data).toMatchObject({ mode: "local", active: false });
    const stillPin = await prisma.user.findUniqueOrThrow({ where: { id: registered.data.user.id } });
    expect(stillPin.unlockKind).toBe("pin");
  });
});
