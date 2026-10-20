import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectAll, coreFilesTouched, registryViolations, writeRegistry } from "./module-registry.mjs";

/** Минимальное «ядро» во временном каталоге: модули, плагины ядра, контракты слотов, схема с маркерами. */
let root;

function put(path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const CONTRACTS = `export interface SlotContracts {
  "habits.insights": A;
  "finance.tabs": B;
}

export interface SlotMeta {
  "finance.tabs": { tabId: string; label: string };
}
`;

function manifest(overrides = {}) {
  return {
    id: "fixture-plugin",
    version: "1.0.0",
    extends: "habits",
    catalog: {
      label: "Фикстура",
      summary: "Тестовый плагин.",
      provides: ["Блок"],
      disableBehavior: "Блок скрывается.",
      defaultEnabled: true
    },
    web: { contributions: [{ slot: "habits.insights", file: "view", export: "FixtureView" }] },
    ...overrides
  };
}

function addPlugin(m = manifest(), name = "fixture-plugin") {
  put(`apps/web/plugins-ext/${name}/plugin.manifest.json`, JSON.stringify(m));
  put(`apps/web/plugins-ext/${name}/view.tsx`, "export const FixtureView = () => null;\n");
}

const problems = () => collectAll(root).errors.join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plugin-registry-"));
  put("apps/api/prisma/schema.prisma", "// <module-registry:workspace-relations>\n// </module-registry:workspace-relations>\n// <module-registry:models>\n// </module-registry:models>\n");
  put("packages/shared-types/src/modules.ts", 'export const CORE_MODULE_IDS = [\n  "habits",\n  "finance"\n] as const;\n');
  put("packages/shared-types/src/plugins.ts", 'export const CORE_PLUGIN_IDS = [\n  "finance-budgeting"\n] as const;\n');
  put("apps/web/lib/extensions/contracts.ts", CONTRACTS);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("plugin-registry: плагин из манифеста", () => {
  it("попадает в каталог и в слоты без правки файлов ядра", () => {
    addPlugin();
    expect(problems()).toBe("");
    const changed = writeRegistry(root);
    expect(changed).toEqual(expect.arrayContaining(["packages/shared-types/src/plugins-ext/registry.generated.ts", "apps/web/plugins-ext/contributions.generated.ts"]));
    const text = (path) => readFileSync(join(root, path), "utf8");
    expect(text("packages/shared-types/src/plugins-ext/registry.generated.ts")).toContain('GENERATED_PLUGIN_IDS = [\n  "fixture-plugin"\n] as const');
    expect(text("packages/shared-types/src/plugins-ext/registry.generated.ts")).toContain('"extendsModuleId": "habits"');
    const contributions = text("apps/web/plugins-ext/contributions.generated.ts");
    expect(contributions).toContain('import("./fixture-plugin/view").then((module) => module.FixtureView)');
    expect(contributions).toContain('contribute("habits.insights", { pluginId: "fixture-plugin", component: FixturePluginFixtureView });');
    expect(registryViolations(root)).toEqual([]);

    const { modules, plugins } = collectAll(root);
    expect(coreFilesTouched([...changed, "apps/web/plugins-ext/fixture-plugin/view.tsx", "apps/web/plugins-ext/fixture-plugin/plugin.manifest.json"], modules, plugins)).toEqual([]);
    expect(coreFilesTouched(["packages/shared-types/src/plugins.ts"], modules, plugins)).toEqual(["packages/shared-types/src/plugins.ts"]);
  });

  it("передаёт order и meta слоту, которому meta нужен", () => {
    addPlugin(manifest({ extends: "finance", web: { contributions: [{ slot: "finance.tabs", file: "view", export: "FixtureView", order: 5, meta: { tabId: "fx", label: "Фикс" } }] } }));
    expect(problems()).toBe("");
    writeRegistry(root);
    expect(readFileSync(join(root, "apps/web/plugins-ext/contributions.generated.ts"), "utf8")).toContain(', order: 5, meta: {"tabId":"fx","label":"Фикс"} });');
  });

  it("без плагинов пишет пустые, но валидные файлы", () => {
    writeRegistry(root);
    expect(readFileSync(join(root, "packages/shared-types/src/plugins-ext/registry.generated.ts"), "utf8")).toContain("GENERATED_PLUGIN_IDS = [] as const");
    expect(readFileSync(join(root, "apps/web/plugins-ext/contributions.generated.ts"), "utf8")).toContain("export {};");
    expect(registryViolations(root)).toEqual([]);
  });
});

describe("plugin-registry: отказы с понятной причиной", () => {
  it("неизвестный слот, занятый id, чужой модуль", () => {
    addPlugin(manifest({ web: { contributions: [{ slot: "habits.unknown", file: "view", export: "FixtureView" }] } }));
    expect(problems()).toContain('слот "habits.unknown" не существует');
    addPlugin(manifest({ id: "finance-budgeting" }), "finance-budgeting");
    expect(problems()).toContain('id "finance-budgeting" занят плагином ядра');
    rmSync(join(root, "apps/web/plugins-ext/finance-budgeting"), { recursive: true });
    addPlugin(manifest({ extends: "nowhere" }));
    expect(problems()).toContain('extends "nowhere"');
  });

  it("meta: обязателен там, где слот его ждёт, и запрещён в остальных", () => {
    addPlugin(manifest({ extends: "finance", web: { contributions: [{ slot: "finance.tabs", file: "view", export: "FixtureView" }] } }));
    expect(problems()).toContain('слоту "finance.tabs" нужен meta');
    addPlugin(manifest({ web: { contributions: [{ slot: "habits.insights", file: "view", export: "FixtureView", meta: { x: 1 } }] } }));
    expect(problems()).toContain('не принимает meta');
  });

  it("каталог без манифеста, отсутствующий файл, серверная часть", () => {
    put("apps/web/plugins-ext/orphan/view.tsx", "export {};\n");
    expect(problems()).toContain("apps/web/plugins-ext/orphan: нет plugin.manifest.json");
    rmSync(join(root, "apps/web/plugins-ext/orphan"), { recursive: true });
    addPlugin(manifest({ web: { contributions: [{ slot: "habits.insights", file: "missing", export: "FixtureView" }] } }));
    expect(problems()).toContain("нет файла apps/web/plugins-ext/fixture-plugin/missing.tsx");
    addPlugin(manifest({ api: { module: "x" } }));
    expect(problems()).toContain("серверную часть плагина манифест пока не описывает");
  });
});
