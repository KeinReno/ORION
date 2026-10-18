import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectModules,
  coreFilesTouched,
  registryViolations,
  renderOutputs,
  spliceRegion,
  writeRegistry
} from "./module-registry.mjs";

/** Минимальная копия «ядра» во временном каталоге: маркеры схемы и список id ядра. */
let root;

function put(path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const SCHEMA = `model Workspace {
  id String @id
  // <module-registry:workspace-relations>
  // </module-registry:workspace-relations>
}

// <module-registry:models>
// </module-registry:models>
`;

const FRAGMENT = `model FixtureThing {
  id          String   @id
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@map("fixture_things")
}`;

const SQL = `CREATE TABLE "fixture_things" ("id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL);
ALTER TABLE "fixture_things" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixture_things" FORCE ROW LEVEL SECURITY;
CREATE POLICY fixture_things_isolation ON "fixture_things" USING (true);
`;

function manifest(overrides = {}) {
  return {
    id: "fixture-mod",
    version: "1.0.0",
    catalog: {
      kind: "additional",
      required: false,
      label: "Фикстура",
      summary: "Тестовый модуль.",
      owns: "Вещи.",
      livesWithout: "Сам по себе.",
      provides: ["Панель"],
      optionalDependencies: ["tasks"],
      disableBehavior: "Данные сохраняются.",
      panelId: "fixture-mod",
      defaultEnabled: true
    },
    permissions: { primaryResource: "thing" },
    api: { module: { file: "fixture-mod.module", export: "FixtureModModule" }, probePath: "/fixture-mod/things" },
    web: { panel: { id: "fixture-mod", label: "Фикстура", icon: "Box", group: "Работа", file: "FixturePanel", export: "FixturePanel" } },
    prisma: {
      fragment: "prisma/models.prisma",
      workspaceBackRelations: ["fixtureThings FixtureThing[]"],
      migrations: [{ name: "20261018120000_fixture_mod", file: "prisma/migration.sql" }]
    },
    data: {
      models: [
        {
          model: "FixtureThing",
          delegate: "fixtureThing",
          snapshotKey: "fixtureThings",
          snapshotPolicy: "included",
          reason: "Пользовательские данные.",
          sync: { syncClass: "lww-fields", stage: "later", note: "LWW." }
        }
      ]
    },
    ...overrides
  };
}

function addFixtureModule(m = manifest(), name = "fixture-mod") {
  put(`apps/api/src/modules-ext/${name}/module.manifest.json`, JSON.stringify(m));
  put(`apps/api/src/modules-ext/${name}/fixture-mod.module.ts`, "export class FixtureModModule {}\n");
  put(`apps/api/src/modules-ext/${name}/prisma/models.prisma`, FRAGMENT);
  put(`apps/api/src/modules-ext/${name}/prisma/migration.sql`, SQL);
  put(`apps/web/modules-ext/${name}/FixturePanel.tsx`, "export const FixturePanel = () => null;\n");
  put(`packages/shared-types/src/modules-ext/${name}/index.ts`, "export {};\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "module-registry-"));
  put("apps/api/prisma/schema.prisma", SCHEMA);
  put("packages/shared-types/src/modules.ts", 'export const CORE_MODULE_IDS = [\n  "tasks",\n  "notes"\n] as const;\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("module-registry: без модулей", () => {
  it("пишет пустые, но валидные реестры и остаётся актуальным", () => {
    expect(writeRegistry(root)).toHaveLength(4);
    expect(registryViolations(root)).toEqual([]);
    expect(readFileSync(join(root, "apps/api/src/modules-ext/modules.generated.ts"), "utf8")).toContain("GENERATED_NEST_MODULES = [];");
    expect(readFileSync(join(root, "packages/shared-types/src/modules-ext/registry.generated.ts"), "utf8")).toContain("GENERATED_MODULE_IDS = [] as const");
    expect(writeRegistry(root)).toEqual([]);
  });
});

describe("module-registry: модуль-фикстура", () => {
  it("добавление каталога с манифестом порождает записи во всех реестрах без правки файлов ядра", () => {
    addFixtureModule();
    const { modules, errors } = collectModules(root);
    expect(errors).toEqual([]);
    const changed = writeRegistry(root);

    // Изменились только генерируемые файлы, область схемы и копия миграции.
    expect(changed.sort()).toEqual(
      [
        "apps/api/prisma/migrations/20261018120000_fixture_mod/migration.sql",
        "apps/api/prisma/schema.prisma",
        "apps/api/src/modules-ext/data.generated.ts",
        "apps/api/src/modules-ext/modules.generated.ts",
        "apps/web/modules-ext/panels.generated.ts",
        "packages/shared-types/src/modules-ext/registry.generated.ts"
      ].sort()
    );
    expect(coreFilesTouched([...changed, "apps/api/src/modules-ext/fixture-mod/module.manifest.json", "apps/web/modules-ext/fixture-mod/FixturePanel.tsx"], modules)).toEqual([]);
    // А правка настоящего файла ядра при добавлении модуля — нарушение.
    expect(coreFilesTouched(["apps/api/src/app.module.ts", "packages/shared-types/src/modules.ts"], modules)).toEqual([
      "apps/api/src/app.module.ts",
      "packages/shared-types/src/modules.ts"
    ]);

    const text = (path) => readFileSync(join(root, path), "utf8");
    expect(text("packages/shared-types/src/modules-ext/registry.generated.ts")).toContain('GENERATED_MODULE_IDS = [\n  "fixture-mod"\n] as const');
    expect(text("packages/shared-types/src/modules-ext/registry.generated.ts")).toContain('"fixture-mod": "thing"');
    expect(text("packages/shared-types/src/modules-ext/registry.generated.ts")).toContain('export * from "./fixture-mod";');
    expect(text("apps/api/src/modules-ext/modules.generated.ts")).toContain('import { FixtureModModule } from "./fixture-mod/fixture-mod.module";');
    expect(text("apps/api/src/modules-ext/modules.generated.ts")).toContain("GENERATED_NEST_MODULES = [FixtureModModule]");
    expect(text("apps/api/src/modules-ext/data.generated.ts")).toContain('"fixture-mod": "/fixture-mod/things"');
    expect(text("apps/api/src/modules-ext/data.generated.ts")).toContain("delegate: (tx) => tx.fixtureThing");
    expect(text("apps/api/src/modules-ext/data.generated.ts")).toContain('"syncClass": "lww-fields"');
    expect(text("apps/web/modules-ext/panels.generated.ts")).toContain('import { Box } from "lucide-react";');
    expect(text("apps/web/modules-ext/panels.generated.ts")).toContain('moduleId: "fixture-mod"');
    expect(text("apps/api/prisma/schema.prisma")).toContain("model FixtureThing {");
    expect(text("apps/api/prisma/schema.prisma")).toContain("  fixtureThings FixtureThing[]");
    expect(text("apps/api/prisma/migrations/20261018120000_fixture_mod/migration.sql")).toBe(SQL);
    expect(registryViolations(root)).toEqual([]);
  });

  it("--check замечает устаревший реестр после правки манифеста", () => {
    addFixtureModule();
    writeRegistry(root);
    addFixtureModule(manifest({ catalog: { ...manifest().catalog, label: "Другое имя" } }));
    expect(registryViolations(root).some((v) => v.includes("registry.generated.ts"))).toBe(true);
    writeRegistry(root);
    expect(registryViolations(root)).toEqual([]);
  });

  it("отвергает id ядра, несовпадение с каталогом, необъявленную модель и таблицу без RLS", () => {
    addFixtureModule(manifest({ id: "tasks" }), "tasks");
    expect(collectModules(root).errors.join("\n")).toContain("занят модулем ядра");

    rmSync(join(root, "apps"), { recursive: true });
    addFixtureModule(manifest({ id: "other" }));
    expect(collectModules(root).errors.join("\n")).toContain("не совпадает с именем каталога");

    rmSync(join(root, "apps"), { recursive: true });
    addFixtureModule(manifest({ data: { models: [] } }));
    expect(collectModules(root).errors.join("\n")).toContain("не описана в data.models");

    rmSync(join(root, "apps"), { recursive: true });
    addFixtureModule();
    put("apps/api/src/modules-ext/fixture-mod/prisma/migration.sql", 'CREATE TABLE "fixture_things" ("id" TEXT);\n');
    expect(collectModules(root).errors.join("\n")).toContain("ENABLE + FORCE ROW LEVEL SECURITY");
  });

  it("отвергает каталог модуля без манифеста", () => {
    put("apps/api/src/modules-ext/lonely/readme.txt", "x");
    expect(collectModules(root).errors.join("\n")).toContain("нет module.manifest.json");
  });

  it("не поддерживает схему без маркеров", () => {
    addFixtureModule();
    put("apps/api/prisma/schema.prisma", "model Workspace {\n}\n");
    expect(() => writeRegistry(root)).toThrow(/маркеров/);
    const { modules } = collectModules(root);
    expect(renderOutputs(modules, root).get("apps/api/prisma/schema.prisma")).toBeNull();
  });
});

describe("spliceRegion", () => {
  it("заменяет только область между маркерами и сохраняет отступ", () => {
    const text = "a\n  // <module-registry:x>\n  old\n  // </module-registry:x>\nb\n";
    expect(spliceRegion(text, "x", ["one", "", "two"])).toBe("a\n  // <module-registry:x>\n  one\n\n  two\n  // </module-registry:x>\nb\n");
    expect(spliceRegion(text, "y", [])).toBeNull();
  });
});

describe("module-registry: настоящий репозиторий", () => {
  it("манифесты валидны, генерируемые файлы актуальны", () => {
    expect(registryViolations()).toEqual([]);
  });
});
