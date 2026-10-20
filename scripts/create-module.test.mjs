import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { architectureViolations, moduleBoundaryViolations } from "./architecture-check.mjs";
import { createModule, idProblems, migrationName, namesOf } from "./create-module.mjs";
import { collectModules, coreFilesTouched, registryViolations, writeRegistry } from "./module-registry.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Минимальная копия «ядра» во временном каталоге: маркеры схемы, id ядра и плагинов, одна старая миграция. */
let root;

function put(path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function snapshot() {
  const files = new Map();
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(relative(root, full).split("\\").join("/"), readFileSync(full, "utf8"));
    }
  })(root);
  return files;
}

function changedSince(before) {
  const after = snapshot();
  return [...after].filter(([path, content]) => before.get(path) !== content).map(([path]) => path).sort();
}

const SCHEMA = `model Workspace {
  id String @id
  // <module-registry:workspace-relations>
  // </module-registry:workspace-relations>
}

model Task {
  id String @id
}

// <module-registry:models>
// </module-registry:models>
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "create-module-"));
  put("apps/api/prisma/schema.prisma", SCHEMA);
  put("packages/shared-types/src/modules.ts", 'export const CORE_MODULE_IDS = [\n  "tasks",\n  "notes"\n] as const;\n');
  put("packages/shared-types/src/plugins.ts", 'export const CORE_PLUGIN_IDS = [\n  "tasks-planning"\n] as const;\n');
  put("apps/web/plugins/tasks-planning/planning.ts", "export {};\n");
  put("apps/web/lib/panel-registry.ts", "export {};\n");
  put("apps/web/panels/TasksPanel.tsx", "export {};\n");
  put("apps/api/src/tasks/tasks.service.ts", "export class TasksService {}\n");
  put("apps/api/prisma/migrations/20261018120000_older/migration.sql", "-- older\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("create-module: скелет проходит проверки платформы", () => {
  it("созданный модуль валиден, реестр актуален, граница модулей не нарушена, меняются только файлы модуля и реестра", () => {
    const before = snapshot();
    const result = createModule({ id: "plants", label: "Растения", root, now: new Date("2026-10-19T08:00:00Z") });
    expect(result.migration).toBe("20261019080000_plants");

    // Манифест проходит валидацию генератора реестра (id, файлы по путям, модели, RLS в миграции).
    const { modules, errors } = collectModules(root);
    expect(errors).toEqual([]);
    expect(modules.map((m) => m.id)).toEqual(["plants"]);

    // Реестр записывается и после этого сверка (то же, что `module-registry --check`) чиста.
    const written = writeRegistry(root);
    expect(registryViolations(root)).toEqual([]);

    // Правило границ модулей (G4) и правило импортов (core ↛ плагины) не нарушены сервисом скелета.
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
    expect(architectureViolations(root)).toEqual([]);
    // Владелец новой модели записан в генерируемую карту владельцев (она нужна правилу границ).
    expect(readFileSync(join(root, "scripts/module-ownership.generated.mjs"), "utf8")).toMatch(/"PlantsItem",\s+"modules-ext"/);

    // Изменились только каталоги модуля, генерируемые файлы, область схемы и копия миграции; файлов ядра — ни одного.
    const changed = changedSince(before);
    expect(changed).toEqual(
      [
        ...result.files,
        ...written
      ].sort()
    );
    expect(coreFilesTouched(changed, modules)).toEqual([]);
    expect(changed.filter((path) => path.startsWith("apps/api/prisma/migrations/"))).toEqual(["apps/api/prisma/migrations/20261019080000_plants/migration.sql"]);
    expect(readFileSync(join(root, "apps/api/prisma/migrations/20261019080000_plants/migration.sql"), "utf8")).toBe(
      readFileSync(join(root, "apps/api/src/modules-ext/plants/prisma/migration.sql"), "utf8")
    );
    expect(readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8")).toContain("  plantsItems PlantsItem[]");
  });

  it("не оставляет неподставленных токенов, пишет русские строки и держит инварианты модуля в сервисе и контроллере", () => {
    createModule({ id: "pet-walks", label: "Прогулки", root });
    const read = (path) => readFileSync(join(root, path), "utf8");
    for (const [path, content] of snapshot()) {
      if (path.startsWith("apps/api/prisma/schema") || path === "packages/shared-types/src/modules.ts") continue;
      expect(content, path).not.toMatch(/@@[A-Z_]+@@/);
    }
    const service = read("apps/api/src/modules-ext/pet-walks/pet-walks.service.ts");
    expect(service).toContain("assertMemberTx");
    expect(service).toContain("this.prisma.withUser");
    expect(service).toContain("function toDto");
    expect(service).toContain("class PetWalksService");
    expect(service).toContain("tx.petWalksItem");
    const controller = read("apps/api/src/modules-ext/pet-walks/pet-walks.controller.ts");
    expect(controller).toContain('@RequireModule("pet-walks")');
    expect(controller).toContain("ZodValidationPipe");
    expect(read("apps/web/modules-ext/pet-walks/PetWalksPanel.tsx")).toMatch(/PanelShell[\s\S]*PanelHeader[\s\S]*PanelBody/);
    expect(read("apps/web/modules-ext/pet-walks/PetWalksPanel.tsx")).toContain('title="Не удалось загрузить записи"');
    const sql = read("apps/api/src/modules-ext/pet-walks/prisma/migration.sql");
    expect(sql).toContain('ALTER TABLE "pet_walks_items" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "pet_walks_items" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY pet_walks_items_isolation ON "pet_walks_items"');
    // Ответная схема без `.default` (инвариант 6 CLAUDE.md): дефолт только во входной схеме.
    const contract = read("packages/shared-types/src/modules-ext/pet-walks/index.ts");
    expect(contract.split("export const petWalksItemSchema")[1].split("export type")[0]).not.toContain(".default(");
    expect(contract).toContain("createPetWalksItemInputSchema");
    expect(existsSync(join(root, "apps/api/test/modules-ext/pet-walks/pet-walks.integration.test.ts"))).toBe(true);
    expect(collectModules(root).errors).toEqual([]);
  });

  it("два модуля подряд живут вместе: уникальные миграции и записи в реестре", () => {
    createModule({ id: "plants", label: "Растения", root, now: new Date("2026-10-19T08:00:00Z") });
    createModule({ id: "books", label: "Книги", root, now: new Date("2026-10-19T08:00:00Z") });
    const { modules, errors } = collectModules(root);
    expect(errors).toEqual([]);
    expect(modules.map((m) => m.id)).toEqual(["books", "plants"]);
    writeRegistry(root);
    expect(registryViolations(root)).toEqual([]);
  });
});

describe("create-module: проверки входа", () => {
  it("отвергает id не в kebab-case, id ядра, плагина, существующего модуля и каталога API", () => {
    expect(idProblems("Bad_Id", root).join()).toContain("kebab-case");
    expect(idProblems("1abc", root).join()).toContain("kebab-case");
    expect(idProblems("a--b", root).join()).toContain("kebab-case");
    expect(idProblems("x".repeat(41), root).join()).toContain("длиннее");
    expect(idProblems("tasks", root).join()).toContain("занят модулем ядра");
    expect(idProblems("tasks-planning", root).join()).toContain("занят плагином");
    createModule({ id: "plants", label: "Растения", root });
    expect(idProblems("plants", root).join()).toContain("уже занят модулем");
    expect(idProblems("fresh-one", root)).toEqual([]);
  });

  it("не перезаписывает существующий каталог и ничего не пишет при ошибке", () => {
    put("apps/web/modules-ext/plants/keep.txt", "мои файлы");
    const before = snapshot();
    expect(() => createModule({ id: "plants", label: "Растения", root })).toThrow(/apps\/web\/modules-ext\/plants уже существует/);
    expect(snapshot()).toEqual(before);
    expect(() => createModule({ id: "tasks", label: "Задачи", root })).toThrow(/занят модулем ядра/);
    expect(() => createModule({ id: "ok", label: "  ", root })).toThrow(/--label/);
    expect(() => createModule({ id: "ok", label: "a\nb", root })).toThrow(/--label/);
    expect(snapshot()).toEqual(before);
  });

  it("не создаёт модель, которая уже есть в schema.prisma", () => {
    put("apps/api/prisma/schema.prisma", SCHEMA + "\nmodel PlantsItem {\n  id String @id\n}\n");
    expect(() => createModule({ id: "plants", label: "Растения", root })).toThrow(/PlantsItem уже есть/);
  });

  it("--dry-run возвращает список файлов и не пишет ничего", () => {
    const before = snapshot();
    const result = createModule({ id: "plants", label: "Растения", root, dryRun: true });
    expect(result.files).toContain("apps/api/src/modules-ext/plants/module.manifest.json");
    expect(result.files).toContain("apps/api/test/modules-ext/plants/plants.integration.test.ts");
    expect(result.generated.join("\n")).toContain("AI_CONTEXT.md");
    expect(snapshot()).toEqual(before);
  });

  it("миграция не получает метку раньше уже существующих", () => {
    expect(migrationName("plants", root, new Date("2020-01-01T00:00:00Z"))).toBe("20261018120001_plants");
    expect(migrationName("pet-walks", root, new Date("2030-01-02T03:04:05Z"))).toBe("20300102030405_pet_walks");
  });

  it("производные имена", () => {
    expect(namesOf("pet-care")).toEqual({ id: "pet-care", pascal: "PetCare", camel: "petCare", snake: "pet_care" });
  });
});

describe("create-module: командная строка (настоящий репозиторий, только проверка)", () => {
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(repoRoot, "scripts/create-module.mjs"), ...args], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }) };
    } catch (error) {
      return { code: error.status, out: String(error.stderr) };
    }
  };

  it("--dry-run печатает список файлов и ничего не создаёт", () => {
    const result = run(["zz-dry-run-check", "--label", "Проверка", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("apps/api/src/modules-ext/zz-dry-run-check/module.manifest.json");
    expect(existsSync(join(repoRoot, "apps/api/src/modules-ext/zz-dry-run-check"))).toBe(false);
  });

  it("занятый id и отсутствие --label дают код 1 и понятное сообщение", () => {
    const busy = run(["pet-care", "--label", "Питомцы", "--dry-run"]);
    expect(busy.code).toBe(1);
    expect(busy.out).toContain("уже занят модулем");
    const noLabel = run(["zz-no-label", "--dry-run"]);
    expect(noLabel.code).toBe(1);
    expect(noLabel.out).toContain("--label");
  });
});
