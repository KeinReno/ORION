import { themeDocumentSchema, type UserPreference } from "@orion/shared-types";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Account-scoped palette persistence, safe validation and legacy preference compatibility. */
describe("Personal custom theme", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `custom-theme-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
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

  const palette = themeDocumentSchema.parse({ schemaVersion: 1, id: "my-palette", name: "Моя палитра", baseMode: "dark",
    colors: Object.fromEntries(themeDocumentSchema.shape.colors.keyof().options.map(key => [key, "#336699"])) });

  it("persists, preserves unrelated old patches, disables without deletion and clears atomically", async () => {
    const user = await register("persist");
    const patch = (body: unknown) => request<UserPreference>("/settings/preferences", { method: "PATCH", token: user.accessToken, body });
    const fresh = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.accessToken });
    expect(fresh.data).toMatchObject({ customTheme: null, customThemeEnabled: false });
    const saved = await patch({ theme: "kaiden-precision", accent: "blue", customTheme: palette, customThemeEnabled: true });
    expect(saved.status).toBe(200); expect(saved.data).toMatchObject({ customTheme: palette, customThemeEnabled: true });
    await patch({ density: "compact" });
    const read = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.accessToken });
    expect(read.data).toMatchObject({ customTheme: palette, customThemeEnabled: true, density: "compact", accent: "blue" });
    expect((await patch({ customThemeEnabled: false })).data).toMatchObject({ customTheme: palette, customThemeEnabled: false });
    expect((await patch({ customThemeEnabled: true })).status).toBe(400);
    expect((await patch({ customTheme: palette, customThemeEnabled: true })).status).toBe(200);
    expect((await patch({ customTheme: null })).data).toMatchObject({ customTheme: null, customThemeEnabled: false });
  });

  it("keeps another user's palette private and requires authentication", async () => {
    const alice = await register("alice"); const bob = await register("bob");
    await request("/settings/preferences", { method: "PATCH", token: alice.accessToken, body: { customTheme: palette, customThemeEnabled: true } });
    const other = await request<UserPreference>("/settings/preferences", { method: "GET", token: bob.accessToken });
    expect(other.data).toMatchObject({ customTheme: null, customThemeEnabled: false });
    expect((await request("/settings/preferences", { method: "GET" })).status).toBe(401);
  });

  it("rejects unknown versions, executable colors and malformed documents without overwriting the saved theme", async () => {
    const user = await register("invalid");
    await request("/settings/preferences", { method: "PATCH", token: user.accessToken, body: { customTheme: palette, customThemeEnabled: true } });
    for (const bad of [
      { ...palette, schemaVersion: 2 }, { ...palette, css: "body {display:none}" },
      { ...palette, colors: { ...palette.colors, accent: "url(https://example.test)" } },
      { ...palette, colors: { ...palette.colors, unknown: "#112233" } }, { ...palette, name: " " },
      { ...palette, colors: {} }, { ...palette, id: "../theme" }
    ]) {
      const response = await request("/settings/preferences", { method: "PATCH", token: user.accessToken, body: { customTheme: bad, customThemeEnabled: true } });
      expect(response.status).toBe(400);
    }
    const read = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.accessToken });
    expect(read.data).toMatchObject({ customTheme: palette, customThemeEnabled: true });
  });
});
