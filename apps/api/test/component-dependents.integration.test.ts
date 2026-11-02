import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPONENT_MANIFESTS, MODULE_CATALOG, PLUGIN_CATALOG, enabledHardDependents } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { GENERATED_MODULE_PROBES } from "../src/modules-ext/data.generated";
import { CapabilityLifecycle } from "../src/common/capability-lifecycle";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { resolve } from "node:path";

/**
 * G6/G7: выключение компонента с включёнными зависимыми требует подтверждения (409 component_has_dependents),
 * обязательный компонент не выключается (409 component_required), сбой хука жизненного цикла откатывает
 * переключение, а выключение любого необязательного модуля не ломает API остальных.
 */
describe("Component dependents and lifecycle (G6, G7)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `component-deps-${runId}`;
  const originalCatalogRoot = process.env.ORION_DEV_CATALOG_ROOT;

  beforeAll(async () => {
    process.env.ORION_DEV_CATALOG_ROOT = resolve(".");
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (originalCatalogRoot === undefined) delete process.env.ORION_DEV_CATALOG_ROOT;
    else process.env.ORION_DEV_CATALOG_ROOT = originalCatalogRoot;
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

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${counter++}@example.test`, password: "integration-password-123", name: "Владелец" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    return {
      token,
      ws,
      setModule: (id: string, enabled: boolean, confirm?: boolean) =>
        request<any>(`/workspaces/${ws}/modules/${id}`, { method: "PATCH", token, body: confirm === undefined ? { enabled } : { enabled, confirm } }),
      setPlugin: (id: string, enabled: boolean, confirm?: boolean) =>
        request<any>(`/workspaces/${ws}/plugins/${id}`, { method: "PATCH", token, body: confirm === undefined ? { enabled } : { enabled, confirm } }),
      get: (path: string) => request<any>(`/workspaces/${ws}${path}`, { method: "GET", token })
    };
  }

  it("blocks disabling a module with an enabled dependent plugin, lists it, and disables on confirm", async () => {
    const { token, ws, setModule, get } = await setup();
    // Данные модуля, который выключаем, и соседа — чтобы проверить, что ничего не удалено.
    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, { method: "POST", token, body: { title: "Останется" } });
    const state = { disabledModules: [], pluginOverrides: [] };
    const expected = enabledHardDependents("tasks", state).map((item) => item.id).sort();
    expect(expected.length).toBeGreaterThan(0);

    const blocked = await setModule("tasks", false);
    expect(blocked.status).toBe(409);
    expect(blocked.data.code).toBe("component_has_dependents");
    expect(blocked.data.message).toContain("перестанут работать");
    expect(blocked.data.dependents.map((item: { id: string }) => item.id).sort()).toEqual(expected);
    expect(blocked.data.dependents).toContainEqual(expect.objectContaining({ kind: "plugin", relation: "requires" }));
    expect(blocked.data.dependents).toContainEqual(expect.objectContaining({ id: "orion-dev", kind: "module", relation: "requires" }));
    // Ничего не изменилось.
    expect((await get("/tasks")).status).toBe(200);

    const confirmed = await setModule("tasks", false, true);
    expect(confirmed.status).toBe(200);
    expect((await get("/tasks")).status).toBe(409);
    // Зависимые плагины неактивны, но их переключатели не тронуты; сосед работает.
    const plugins = await get("/plugins");
    for (const dependent of blocked.data.dependents.filter((item: { kind: string }) => item.kind === "plugin")) {
      expect(plugins.data.find((item: { id: string }) => item.id === dependent.id).enabled).toBe(false);
    }
    expect((await get("/development-import/preview")).status).toBe(409);
    expect((await get("/notes")).status).toBe(200);

    // Возврат: данные на месте, а повторное включение не требует подтверждения.
    expect((await setModule("tasks", true)).status).toBe(200);
    const list = await get("/tasks");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.data)).toContain(task.data.id);
  });

  it("does not ask for confirmation once the dependent plugins are off, and plugin toggles need none", async () => {
    const { setModule, setPlugin } = await setup();
    const dependents = enabledHardDependents("habits", { disabledModules: [], pluginOverrides: [] });
    for (const item of dependents) expect((await setPlugin(item.id, false)).status).toBe(200);
    expect((await setModule("habits", false)).status).toBe(200);
  });

  it("refuses to disable a required component with component_required and never disables it", async () => {
    const { setModule, get } = await setup();
    const manifest = MODULE_CATALOG.find((item) => item.id === "notes") as { required: boolean };
    manifest.required = true;
    try {
      for (const confirm of [undefined, true]) {
        const response = await setModule("notes", false, confirm);
        expect(response.status).toBe(409);
        expect(response.data.code).toBe("component_required");
      }
      expect((await get("/notes")).status).toBe(200);
    } finally {
      manifest.required = false;
    }
  });

  it("rolls the toggle back when a lifecycle hook throws, and runs hooks in the same transaction", async () => {
    const { ws, setModule, setPlugin, get } = await setup();
    const lifecycle = app.get(CapabilityLifecycle);
    const calls: string[] = [];
    const plugin = PLUGIN_CATALOG.find((item) => item.extendsModuleId === "calendar" && item.defaultEnabled)!;
    lifecycle.registerComponent("contacts", {
      onDisable: async (tx, ctx) => {
        calls.push(`disable:${ctx.id}:${ctx.workspaceId === ws}`);
        // Хук видит собственное переключение (та же транзакция) и может его сорвать.
        const row = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { disabledModules: true } });
        calls.push(`sees:${row.disabledModules.includes("contacts")}`);
        throw new Error("синтетический сбой");
      },
      onEnable: async (_tx, ctx) => {
        calls.push(`enable:${ctx.id}`);
      }
    });
    lifecycle.registerComponent(plugin.id, {
      onDisable: async () => {
        throw new Error("сбой плагина");
      }
    });
    try {
      const failed = await setModule("contacts", false);
      expect(failed.status).toBe(500);
      expect(String(failed.data.message)).toContain("Изменение отменено");
      expect(calls).toEqual([`disable:contacts:true`, "sees:true"]);
      const modules = await get("/modules");
      expect(modules.data.find((item: { id: string }) => item.id === "contacts").enabled).toBe(true);

      const pluginFailed = await setPlugin(plugin.id, false);
      expect(pluginFailed.status).toBe(500);
      const plugins = await get("/plugins");
      expect(plugins.data.find((item: { id: string }) => item.id === plugin.id).enabled).toBe(true);

      // Включение не вызывает onDisable; сбоя нет.
      calls.length = 0;
      expect((await setModule("contacts", true)).status).toBe(200);
      expect(calls).toEqual(["enable:contacts"]);
    } finally {
      lifecycle.unregisterComponent("contacts");
      lifecycle.unregisterComponent(plugin.id);
    }
  });

  it("rejects incompatible activation before hooks/state writes and preserves disabled data", async () => {
    const { ws, token, setModule, get } = await setup();
    const pet = await request<{ id: string }>(`/workspaces/${ws}/pet-care/pets`, { method: "POST", token, body: { name: "Сохранится", species: "cat" } });
    expect(pet.status).toBe(201);
    expect((await setModule("pet-care", false)).status).toBe(200);
    const manifest = COMPONENT_MANIFESTS.find(m => m.id === "pet-care")!;
    const original = manifest.requires;
    let calls = 0;
    const lifecycle = app.get(CapabilityLifecycle);
    lifecycle.registerComponent("pet-care", { onEnable: async () => { calls++; } });
    try {
      const member = await setup();
      const who = await request<{ id: string }>("/auth/me", { method: "GET", token: member.token });
      await prisma.asSystem(tx => tx.workspaceMember.create({ data: { workspaceId: ws, userId: who.data.id, role: "member" } }));
      manifest.requires = { ...original, platform: "^99.0.0" };
      expect((await request(`/workspaces/${ws}/modules/pet-care`, { method: "PATCH", token: member.token, body: { enabled: true } })).status).toBe(403);
      for (const requires of [
        { ...original, platform: "^99.0.0" },
        { ...original, contracts: { event: "^99.0.0" } },
        { ...original, modules: ["notes"], moduleVersions: { notes: "^99.0.0" } },
        { ...original, modules: ["missing-module"] }
      ]) {
        manifest.requires = requires;
        const rejected = await setModule("pet-care", true);
        expect(rejected.status).toBe(409);
        expect(rejected.data.code).toBe("component_incompatible");
        expect((await get("/modules")).data.find((m: { id: string }) => m.id === "pet-care").enabled).toBe(false);
        expect(calls).toBe(0);
      }
      manifest.requires = original;
      expect((await setModule("pet-care", true)).status).toBe(200);
      expect(calls).toBe(1);
      expect((await get("/pet-care/pets")).data).toContainEqual(expect.objectContaining({ id: pet.data.id }));
      manifest.requires = { ...original, platform: "^99.0.0" };
      expect((await get("/pet-care/pets")).status).toBe(409); // default/already-on does not bypass compatibility
      expect((await setModule("pet-care", false)).status).toBe(200);
    } finally {
      manifest.requires = original;
      lifecycle.unregisterComponent("pet-care");
    }
  });

  it("requires an enabled compatible host before enabling a plugin, without changing its override", async () => {
    const { setModule, setPlugin, get } = await setup();
    const plugin = PLUGIN_CATALOG.find(p => p.extendsModuleId === "habits")!;
    expect((await setModule("habits", false, true)).status).toBe(200);
    const before = (await get("/plugins")).data;
    const rejected = await setPlugin(plugin.id, true);
    expect(rejected.status).toBe(409);
    expect(rejected.data.code).toBe("component_incompatible");
    expect((await get("/plugins")).data).toEqual(before);
    expect((await setModule("habits", true)).status).toBe(200);
    const manifest = COMPONENT_MANIFESTS.find(m => m.id === plugin.id)!;
    const original = manifest.requires;
    try {
      manifest.requires = { ...original, contracts: { plugin: "^99.0.0" } };
      const incompatible = await setPlugin(plugin.id, true);
      expect(incompatible.status).toBe(409);
      expect(incompatible.data.code).toBe("component_incompatible");
    } finally { manifest.requires = original; }
    expect((await setPlugin(plugin.id, true)).status).toBe(200);
  });

  it("matrix: switching off any optional module leaves every other enabled module's API answering", async () => {
    const { ws, token, setModule, get } = await setup();
    const probes: Record<string, string> = {
      tasks: "/tasks",
      notes: "/notes",
      knowledge: "/knowledge/items",
      calendar: "/events?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z",
      documents: "/documents",
      projects: "/projects",
      time: "/time/running",
      finance: "/finance/accounts",
      habits: "/habits",
      lists: "/lists",
      inventory: "/inventory/items",
      markets: "/markets/trades",
      opportunities: "/opportunities",
      home: "/homes",
      contacts: "/contacts",
      health: "/health/subjects",
      // G5: маршруты подключаемых модулей берутся из их манифестов (api.probePath).
      ...GENERATED_MODULE_PROBES
    };
    expect(Object.keys(probes).sort()).toEqual(MODULE_CATALOG.map((item) => item.id).sort());
    const initial = await get("/modules");
    const startEnabled = initial.data.filter((item: { enabled: boolean }) => item.enabled).map((item: { id: string }) => item.id);
    for (const target of MODULE_CATALOG.filter((item) => !item.required && startEnabled.includes(item.id))) {
      expect((await setModule(target.id, false, true)).status, `выключение ${target.id}`).toBe(200);
      const blockedModules = new Set(enabledHardDependents(target.id, {
        disabledModules: MODULE_CATALOG.filter(item => !startEnabled.includes(item.id)).map(item => item.id), pluginOverrides: []
      }).filter(item => item.kind === "module").map(item => item.id));
      for (const other of startEnabled.filter((id: string) => id !== target.id)) {
        const response = await request(`/workspaces/${ws}${probes[other]}`, { method: "GET", token });
        expect(response.status, `${other} после выключения ${target.id}`).toBeLessThan(500);
        if (blockedModules.has(other)) {
          expect(response.status, `${other} требует ${target.id}`).toBe(409);
          expect(response.data).toMatchObject({ code: "component_incompatible" });
        } else {
          expect(response.status, `${other} после выключения ${target.id}`).not.toBe(409);
        }
      }
      expect((await get(probes[target.id]!)).status).toBe(409);
      expect((await setModule(target.id, true)).status).toBe(200);
    }
  }, 120_000);
});
