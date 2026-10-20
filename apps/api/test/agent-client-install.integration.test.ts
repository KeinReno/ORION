import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * «Подключить в один клик»: ORION writes itself into an AI program's MCP config on this computer. Against a real API with
 * a scratch home folder — what lands in the file, what stays, what is refused, and that the token works.
 */
describe("Agent client one-click install", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const emailPrefix = `install-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "orion-install-it-"));
  const previousHome = process.env.ORION_AGENT_CLIENT_HOME;

  beforeAll(async () => {
    process.env.ORION_AGENT_CLIENT_HOME = home;
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
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: [...new Set(memberships.map((m) => m.workspaceId))] } } });
      });
    }
    await app?.close();
    process.env.ORION_AGENT_CLIENT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function call<T = unknown>(route: string, options: { method?: string; token?: string; body?: unknown; form?: boolean } = {}): Promise<{ status: number; data: T; text: string }> {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": options.form ? "application/x-www-form-urlencoded" : "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : options.form ? String(options.body) : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    return { status: response.status, data: data as T, text };
  }

  async function register(name: string): Promise<{ token: string; workspaceId: string }> {
    const response = await call<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await call<Array<{ id: string }>>("/workspaces/me", { token: response.data.accessToken });
    return { token: response.data.accessToken, workspaceId: workspaces.data[0]!.id };
  }

  it("writes the orion entry into Claude Desktop's config, keeps the rest, backs it up, and the token works", async () => {
    const user = await register("desktop");
    const config = path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
    if (process.platform === "win32") {
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: "gh" } }, theme: "dark" }));
    }
    const route = `/workspaces/${user.workspaceId}/agent-connection/install`;
    const installed = await call<{ configPath: string; backupPath: string | null; tokenName: string; revokedPrevious: number }>(route, {
      method: "POST",
      token: user.token,
      body: { client: "claude-desktop", scopes: ["tasks:read", "tasks:write"] }
    });
    expect(installed.status, installed.text).toBe(200);
    expect(installed.text).not.toContain("oat_");
    const written = JSON.parse(fs.readFileSync(installed.data.configPath, "utf8")) as { mcpServers: Record<string, { env: Record<string, string> }>; theme?: string };
    if (process.platform === "win32") {
      expect(written.theme).toBe("dark");
      expect(written.mcpServers.github).toEqual({ command: "gh" });
      expect(installed.data.backupPath).not.toBeNull();
    }
    const secret = written.mcpServers.orion!.env.ORION_AGENT_TOKEN!;
    expect((await call("/ai/v1/tasks", { token: secret })).status).toBe(200);

    // Connecting again replaces the entry and revokes the previous token of that program.
    const again = await call<{ revokedPrevious: number; configPath: string }>(route, { method: "POST", token: user.token, body: { client: "claude-desktop", scopes: ["tasks:read"] } });
    expect(again.data.revokedPrevious).toBe(1);
    expect((await call("/ai/v1/tasks", { token: secret })).status).toBe(401);
  });

  it("never overwrites a config it cannot read, and refuses a form post", async () => {
    const user = await register("broken");
    const cursor = path.join(home, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(cursor), { recursive: true });
    fs.writeFileSync(cursor, "{ not json");
    const route = `/workspaces/${user.workspaceId}/agent-connection/install`;
    const refused = await call(route, { method: "POST", token: user.token, body: { client: "cursor", scopes: ["tasks:read"] } });
    expect(refused.status).toBe(400);
    expect(fs.readFileSync(cursor, "utf8")).toBe("{ not json");
    const tokens = await call<Array<{ name: string }>>(`/workspaces/${user.workspaceId}/agent-tokens`, { token: user.token });
    expect(tokens.data.filter((token) => token.name === "Cursor")).toHaveLength(0);

    expect((await call(route, { method: "POST", token: user.token, body: "client=cursor", form: true })).status).toBe(403);
  });
});
