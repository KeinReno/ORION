import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** ADR-0022, E2: the extensions endpoints against a real API — who may approve, what is served, what a changed file does. */
describe("Extensions from the folder", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `ext-${runId}`;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orion-ext-it-"));
  const extensionsDir = path.join(scratch, "extensions");
  const previous = { dir: process.env.ORION_EXTENSIONS_DIR, node: process.env.ORION_NODE_DIR };

  function writeExtension(code: string): void {
    fs.mkdirSync(path.join(extensionsDir, "hello-it"), { recursive: true });
    fs.writeFileSync(
      path.join(extensionsDir, "hello-it", "orion.extension.json"),
      JSON.stringify({ id: "hello-it", name: "Привет", version: "0.1.0", engines: { orion: "^1.0.0" }, permissions: { network: ["api.example.com"] } })
    );
    fs.writeFileSync(path.join(extensionsDir, "hello-it", "web.js"), code);
  }

  beforeAll(async () => {
    process.env.ORION_EXTENSIONS_DIR = extensionsDir;
    process.env.ORION_NODE_DIR = path.join(scratch, "node");
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
    process.env.ORION_EXTENSIONS_DIR = previous.dir;
    process.env.ORION_NODE_DIR = previous.node;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function call<T = unknown>(route: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; data: T; text: string }> {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    return { status: response.status, data: data as T, text };
  }

  async function register(name: string): Promise<{ token: string; userId: string }> {
    const response = await call<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    return { token: response.data.accessToken, userId: response.data.user.id };
  }

  type State = { available: boolean; canManage: boolean; items: Array<{ id: string; status: string; sha256: string | null; entryPath: string | null; permissions: { network: string[] } | null }> };

  it("finds, approves, serves; refuses a changed file until approved again or dev mode is on", async () => {
    writeExtension("export function activate() {}\n");
    const owner = await register("owner");

    expect((await call("/extensions")).status).toBe(401);
    const found = await call<State>("/extensions", { token: owner.token });
    expect(found.data).toMatchObject({ available: true, canManage: true });
    const item = found.data.items.find((entry) => entry.id === "hello-it")!;
    expect(item).toMatchObject({ status: "pending", entryPath: null, permissions: { network: ["api.example.com"] } });
    expect((await call("/extensions/hello-it/web.js")).status).toBe(404);

    // A hash that is not the current one (file swapped while the user looked) is refused.
    expect((await call("/extensions/hello-it/approve", { method: "POST", token: owner.token, body: { sha256: "0".repeat(64) } })).status).toBe(409);
    const approved = await call<{ status: string; entryPath: string }>("/extensions/hello-it/approve", { method: "POST", token: owner.token, body: { sha256: item.sha256 } });
    expect(approved.status).toBe(200);
    expect(approved.data.status).toBe("approved");
    const served = await call(approved.data.entryPath);
    expect(served.status).toBe(200);
    expect(served.text).toBe("export function activate() {}\n");

    // Edited after approval: not served any more.
    writeExtension("export function activate() { /* edited */ }\n");
    const changed = await call<State>("/extensions", { token: owner.token });
    expect(changed.data.items.find((entry) => entry.id === "hello-it")?.status).toBe("changed");
    expect((await call("/extensions/hello-it/web.js")).status).toBe(404);

    // Dev mode: the current file is served without approving again.
    expect((await call("/extensions/hello-it", { method: "PATCH", token: owner.token, body: { devMode: true } })).status).toBe(200);
    const dev = await call("/extensions/hello-it/web.js");
    expect(dev.status).toBe(200);
    expect(dev.text).toContain("edited");

    // Switched off and revoked.
    await call("/extensions/hello-it", { method: "PATCH", token: owner.token, body: { enabled: false } });
    expect((await call("/extensions/hello-it/web.js")).status).toBe(404);
    expect((await call("/extensions/hello-it/approval", { method: "DELETE", token: owner.token })).status).toBe(204);
    const revoked = await call<State>("/extensions", { token: owner.token });
    expect(revoked.data.items.find((entry) => entry.id === "hello-it")?.status).toBe("pending");
  });

  describe("E3: data, secrets, network", () => {
    async function approvedDataExtension(token: string, permissions: Record<string, unknown> = { storage: true, secrets: ["api_key"], network: ["api.example.com"] }): Promise<void> {
      fs.mkdirSync(path.join(extensionsDir, "data-it"), { recursive: true });
      fs.writeFileSync(
        path.join(extensionsDir, "data-it", "orion.extension.json"),
        JSON.stringify({ id: "data-it", name: "Данные", version: "0.1.0", engines: { orion: "^1.0.0" }, permissions })
      );
      fs.writeFileSync(path.join(extensionsDir, "data-it", "web.js"), "export function activate() {}\n");
      const state = await call<State>("/extensions", { token });
      const sha = state.data.items.find((entry) => entry.id === "data-it")!.sha256;
      expect((await call("/extensions/data-it/approve", { method: "POST", token, body: { sha256: sha } })).status).toBe(200);
    }
    async function workspaceOf(token: string): Promise<string> {
      return (await call<Array<{ id: string }>>("/workspaces/me", { token })).data[0].id;
    }

    it("stores records per workspace, isolated from non-members, within limits", async () => {
      const alice = await register("data-alice");
      const bob = await register("data-bob");
      await approvedDataExtension(alice.token);
      const ws = await workspaceOf(alice.token);
      const base = `/workspaces/${ws}/ext/data-it/collections/usage`;

      const put = await call<{ key: string; data: unknown }>(`${base}/2026-10-20`, { method: "PUT", token: alice.token, body: { data: { tokens: 1200 } } });
      expect(put.status).toBe(200);
      await call(`${base}/2026-10-20`, { method: "PUT", token: alice.token, body: { data: { tokens: 1500 } } });
      const list = await call<Array<{ key: string; data: { tokens: number } }>>(base, { token: alice.token });
      expect(list.data).toEqual([expect.objectContaining({ key: "2026-10-20", data: { tokens: 1500 } })]);

      expect((await call(base, { token: bob.token })).status).toBe(403);
      expect((await call(`${base}/bad key`, { method: "PUT", token: alice.token, body: { data: 1 } })).status).toBe(400);
      expect((await call(`${base}/big`, { method: "PUT", token: alice.token, body: { data: "x".repeat(70_000) } })).status).toBe(400);
      expect((await call(`${base}/2026-10-20`, { method: "DELETE", token: alice.token })).status).toBe(204);
      expect((await call<unknown[]>(base, { token: alice.token })).data).toEqual([]);

      // The database itself hides the rows from a non-member (RLS), not only the service check.
      await call(`${base}/again`, { method: "PUT", token: alice.token, body: { data: 1 } });
      const seenByBob = await prisma.withUser(bob.userId, (tx) => tx.extensionRecord.count({ where: { workspaceId: ws } }));
      expect(seenByBob).toBe(0);
    });

    it("refuses storage the manifest did not declare, and anything for a switched-off extension", async () => {
      const carol = await register("data-carol");
      await approvedDataExtension(carol.token, { storage: false });
      const ws = await workspaceOf(carol.token);
      expect((await call(`/workspaces/${ws}/ext/data-it/collections/usage`, { token: carol.token })).status).toBe(403);
      await approvedDataExtension(carol.token);
      await call("/extensions/data-it", { method: "PATCH", token: carol.token, body: { enabled: false } });
      expect((await call(`/workspaces/${ws}/ext/data-it/collections/usage`, { token: carol.token })).status).toBe(409);
    });

    it("keeps secrets per user and never returns the value", async () => {
      const dave = await register("data-dave");
      const erin = await register("data-erin");
      await approvedDataExtension(dave.token);
      const set = await call<{ name: string; set: boolean }>("/extensions/data-it/secrets/api_key", { method: "PUT", token: dave.token, body: { value: "sk-very-secret" } });
      expect(set.data).toMatchObject({ name: "api_key", set: true });
      expect(set.text).not.toContain("sk-very-secret");
      const mine = await call<Array<{ name: string; set: boolean }>>("/extensions/data-it/secrets", { token: dave.token });
      expect(mine.data).toEqual([expect.objectContaining({ name: "api_key", set: true })]);
      expect(mine.text).not.toContain("sk-very-secret");
      const theirs = await call<Array<{ name: string; set: boolean }>>("/extensions/data-it/secrets", { token: erin.token });
      expect(theirs.data).toEqual([expect.objectContaining({ name: "api_key", set: false })]);
      expect((await call("/extensions/data-it/secrets/other", { method: "PUT", token: dave.token, body: { value: "x" } })).status).toBe(404);
      const stored = await prisma.asSystem((tx) => tx.extensionSecret.findFirstOrThrow({ where: { userId: dave.userId } }));
      expect(stored.valueEnc).not.toContain("sk-very-secret");
    });

    it("network: only https to a declared host, declared secrets that are set, no server-owned headers", async () => {
      const frank = await register("data-frank");
      await approvedDataExtension(frank.token);
      const ws = await workspaceOf(frank.token);
      const fetchVia = (body: unknown) => call(`/workspaces/${ws}/ext/data-it/fetch`, { method: "POST", token: frank.token, body });
      expect((await fetchVia({ url: "https://evil.example.org/x" })).status).toBe(403);
      expect((await fetchVia({ url: "http://api.example.com/x" })).status).toBe(400);
      expect((await fetchVia({ url: "https://api.example.com/x", headers: { Host: "other.example.com" } })).status).toBe(400);
      expect((await fetchVia({ url: "https://api.example.com/x", headers: { Authorization: "Bearer {{secret:undeclared}}" } })).status).toBe(403);
      expect((await fetchVia({ url: "https://api.example.com/x", headers: { Authorization: "Bearer {{secret:api_key}}" } })).status).toBe(409);
    });
  });

  it("only an owner of some workspace may approve, and only with a JSON request", async () => {
    writeExtension("export function activate() {}\n");
    const guest = await register("guest");
    // Make the guest own nothing: their personal workspace membership becomes a plain member.
    await prisma.asSystem((tx) => tx.workspaceMember.updateMany({ where: { userId: guest.userId }, data: { role: "member" } }));
    const state = await call<State>("/extensions", { token: guest.token });
    expect(state.data.canManage).toBe(false);
    const sha = state.data.items.find((entry) => entry.id === "hello-it")!.sha256;
    expect((await call("/extensions/hello-it/approve", { method: "POST", token: guest.token, body: { sha256: sha } })).status).toBe(403);

    const owner = await register("owner-form");
    const form = await fetch(`${baseUrl}/extensions/hello-it/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${owner.token}` },
      body: `sha256=${sha}`
    });
    expect(form.status).toBe(403);
  });
});
