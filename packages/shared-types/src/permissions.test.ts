import { describe, expect, it } from "vitest";
import { AGENT_SCOPES } from "./agent";
import { permissionsFromScopes } from "./agent-policy";
import { AGENT_TOOLS } from "./agent-tools";
import { COMPONENT_MANIFESTS } from "./component-manifest";
import { ORION_MODULE_IDS } from "./modules";
import {
  AGENT_SCOPE_PERMISSIONS,
  PERMISSION_IDS,
  isAllowed,
  isRegisteredPermission,
  permissionsOfModule,
  permissionsOfScopes
} from "./permissions";

describe("реестр разрешений", () => {
  it("id уникальны и имеют вид module.resource.action", () => {
    expect(new Set(PERMISSION_IDS).size).toBe(PERMISSION_IDS.length);
    for (const id of PERMISSION_IDS) expect(id).toMatch(/^[a-z]+\.[a-z_]+\.(read|create|update|delete|propose|manage)$/);
  });

  it("у каждого модуля есть как минимум чтение и запись", () => {
    for (const moduleId of ORION_MODULE_IDS) {
      const own = permissionsOfModule(moduleId);
      expect(own.some((p) => p.endsWith(".read")), `${moduleId}: read`).toBe(true);
      expect(own.some((p) => p.endsWith(".create") || p.endsWith(".update")), `${moduleId}: write`).toBe(true);
    }
  });

  it("манифесты ссылаются только на разрешения из реестра, а модуль объявляет свои", () => {
    for (const manifest of COMPONENT_MANIFESTS) {
      for (const permission of manifest.permissions) expect(isRegisteredPermission(permission), `${manifest.id}: ${permission}`).toBe(true);
      if (manifest.kind === "module") expect(manifest.permissions).toEqual(permissionsOfModule(manifest.id as (typeof ORION_MODULE_IDS)[number]));
    }
  });
});

describe("scope агента → разрешения", () => {
  it("каждый scope отображается на зарегистрированные разрешения", () => {
    for (const scope of AGENT_SCOPES) {
      expect(AGENT_SCOPE_PERMISSIONS[scope].length, scope).toBeGreaterThan(0);
      for (const permission of AGENT_SCOPE_PERMISSIONS[scope]) expect(isRegisteredPermission(permission), `${scope}: ${permission}`).toBe(true);
    }
  });

  it("scope'ы каждого инструмента агента отображаются на зарегистрированные разрешения", () => {
    for (const tool of AGENT_TOOLS) {
      for (const scope of tool.scopes ?? []) for (const permission of AGENT_SCOPE_PERMISSIONS[scope]) expect(isRegisteredPermission(permission), tool.name).toBe(true);
    }
  });

  it("отображение согласовано с агентской матрицей (permissionsFromScopes)", () => {
    const matrixModuleToRegistry = { tasks: "tasks.task", notes: "notes.note", events: "calendar.event", projects: "projects.project" } as const;
    const all = permissionsOfScopes(AGENT_SCOPES);
    const matrix = permissionsFromScopes(AGENT_SCOPES);
    for (const [module, prefix] of Object.entries(matrixModuleToRegistry) as [keyof typeof matrixModuleToRegistry, string][]) {
      for (const op of matrix[module]) {
        if (op === "propose") continue; // propose у задач/заметок/событий — режим assistant поверх update
        expect(all.has(`${prefix}.${op}`), `${module}.${op}`).toBe(true);
      }
    }
    // Никаких удалений агенту не выдаётся через заметки/задачи/события.
    for (const permission of all) expect(permission.startsWith("tasks.task.delete")).toBe(false);
  });
});

describe("isAllowed", () => {
  it("человек: все операции (ролей с урезанными правами пока нет), но не незарегистрированные", () => {
    for (const role of ["owner", "lead", "member"] as const) expect(isAllowed({ kind: "user", role }, "tasks.task.update")).toBe(true);
    expect(isAllowed({ kind: "user" }, "tasks.task.create")).toBe(true);
    expect(isAllowed({ kind: "user" }, "tasks.task.fly")).toBe(false);
  });

  it("агент: только то, что дают scope'ы", () => {
    expect(isAllowed({ kind: "agent", scopes: ["tasks:read"] }, "tasks.task.read")).toBe(true);
    expect(isAllowed({ kind: "agent", scopes: ["tasks:read"] }, "tasks.task.create")).toBe(false);
    expect(isAllowed({ kind: "agent", scopes: ["tasks:write"] }, "tasks.task.update")).toBe(true);
    expect(isAllowed({ kind: "agent", scopes: ["tasks:write"] }, "tasks.task.delete")).toBe(false);
    expect(isAllowed({ kind: "agent", scopes: [] }, "tasks.task.read")).toBe(false);
  });

  it("плагин: только объявленное в манифесте", () => {
    expect(isAllowed({ kind: "plugin", declared: [] }, "tasks.task.update")).toBe(false);
    expect(isAllowed({ kind: "plugin", declared: ["tasks.task.read"] }, "tasks.task.read")).toBe(true);
    expect(isAllowed({ kind: "plugin", declared: ["tasks.task.read"] }, "tasks.task.update")).toBe(false);
  });
});
