import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareArchitectSchemas, type ArchitectProjectSchema } from "@orion/shared-types";
import {
  analyzeRepository,
  extractRustModuleRefs,
  extractLaunchPoints,
  extractTsImports,
  normalizeSubPath,
  resolveTsImport
} from "./architect-analyzer";

let root: string;

beforeAll(async () => {
  root = join(process.cwd(), "tmp", `architect-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(join(root, "apps/web"), { recursive: true });
  await fs.mkdir(join(root, "packages/core/src"), { recursive: true });
  await fs.mkdir(join(root, "node_modules/left-pad"), { recursive: true });
  await fs.mkdir(join(root, "rust/crate/src"), { recursive: true });
  await fs.writeFile(join(root, "apps/web/index.ts"), [
    'import { helper } from "./util";',
    'import { x } from "../../packages/core/src";',
    'import react from "react";',
    'export { y } from "../../packages/core/src/x";',
    'const lazy = import("./lazy");'
  ].join("\n"));
  await fs.writeFile(join(root, "apps/web/util.ts"), "export const helper = () => 1;\n");
  await fs.writeFile(join(root, "apps/web/lazy.ts"), "export const lazy = 1;\n");
  await fs.writeFile(join(root, "packages/core/src/index.ts"), 'export * from "./x";\n');
  await fs.writeFile(join(root, "packages/core/src/x.ts"), "export const x = 1;\n");
  await fs.writeFile(join(root, "node_modules/left-pad/index.js"), "module.exports = 1;\n");
  await fs.writeFile(join(root, "rust/crate/Cargo.toml"), "[package]\nname = \"demo\"\n");
  await fs.writeFile(join(root, "rust/crate/src/main.rs"), "mod util;\nuse crate::util::helper;\nfn main() { helper(); }\n");
  await fs.writeFile(join(root, "rust/crate/src/util.rs"), "pub fn helper() {}\n");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("extractLaunchPoints", () => {
  it("видит вход, маршрут, расписание и скрипты, импорт точкой запуска не считает", () => {
    expect(extractLaunchPoints("apps/api/src/main.ts", "import { AppModule } from './app.module';\nNestFactory.create(AppModule);\n").map(item => item.kind)).toEqual(["main"]);
    expect(extractLaunchPoints("apps/api/src/notes/notes.controller.ts", "@Get('list')\n@Cron(CronExpression.EVERY_MINUTE)\n").map(item => item.label)).toEqual(["EVERY_MINUTE", "GET list"]);
    expect(extractLaunchPoints("package.json", JSON.stringify({ scripts: { dev: "nest start" } }))).toEqual([{ path: "package.json", kind: "script", label: "dev: nest start" }]);
    expect(extractLaunchPoints("apps/web/util.ts", "export const helper = 1;\n")).toEqual([]);
  });
});

describe("analyzeRepository", () => {
  it("строит файловую карту: файлы, каталоги, модуль с index.ts и крейт с Cargo.toml", async () => {
    const { nodes, metrics } = await analyzeRepository({ rootPath: root });
    const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
    expect(kinds.get("apps/web/index.ts")).toBe("file");
    expect(kinds.get("apps/web")).toBe("module");
    expect(kinds.get("packages/core/src")).toBe("module");
    expect(kinds.get("rust/crate")).toBe("crate");
    expect(kinds.get("apps")).toBe("dir");
    // node_modules не попадает в карту.
    expect(kinds.has("node_modules/left-pad/index.js")).toBe(false);
    expect(metrics.files).toBeGreaterThanOrEqual(7);
    expect(metrics.modules).toBe(2);
    expect(metrics.crates).toBe(1);
  });

  it("внутренние импорты TS/TSX разрешаются в файлы, внешние — в пакет", async () => {
    const { edges } = await analyzeRepository({ rootPath: root });
    const pairs = edges.map((edge) => `${edge.from}->${edge.to}`);
    expect(pairs).toContain("apps/web/index.ts->apps/web/util.ts");
    expect(pairs).toContain("apps/web/index.ts->packages/core/src/index.ts");
    expect(pairs).toContain("apps/web/index.ts->packages/core/src/x.ts");
    expect(pairs).toContain("apps/web/index.ts->apps/web/lazy.ts");
    expect(pairs).toContain("apps/web/index.ts->external:react");
    expect(pairs).toContain("packages/core/src/index.ts->packages/core/src/x.ts");
  });

  it("Rust: mod и use crate:: находят файлы модулей", async () => {
    const { edges } = await analyzeRepository({ rootPath: root });
    const pairs = edges.map((edge) => `${edge.from}->${edge.to}`);
    expect(pairs).toContain("rust/crate/src/main.rs->rust/crate/src/util.rs");
  });

  it("подкаталог ограничивает карту, но id остаются путями от корня", async () => {
    const { nodes } = await analyzeRepository({ rootPath: root, subPath: "apps" });
    expect(nodes.every((node) => node.id.startsWith("apps"))).toBe(true);
    expect(nodes.some((node) => node.id === "apps/web/index.ts")).toBe(true);
    expect(nodes.some((node) => node.id === "packages/core/src/index.ts")).toBe(false);
  });

  it("выход за пределы репозитория отвергается", () => {
    expect(() => normalizeSubPath(root, "../secret")).toThrow("за пределы");
    expect(() => normalizeSubPath(root, "/etc")).not.toThrow(); // абсолютный путь трактуется как путь внутри корня
    expect(normalizeSubPath(root, "apps/web")).toBe("apps/web");
  });
});

describe("разбор импортов", () => {
  it("TS: import/export/require/import() без дублей", () => {
    const source = [
      'import a from "a";',
      'import { b } from "b";',
      'export * from "c";',
      'const d = require("d");',
      'const e = import("e");',
      'import "a";'
    ].join("\n");
    expect(extractTsImports(source)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("TS: расширение .js в импорте находит .ts; импорт вне корня не разрешается", () => {
    const files = new Set(["src/a.ts", "src/dir/index.tsx"]);
    expect(resolveTsImport("src/main.ts", "./a.js", files)).toBe("src/a.ts");
    expect(resolveTsImport("src/main.ts", "./dir", files)).toBe("src/dir/index.tsx");
    expect(resolveTsImport("src/main.ts", "../../outside", files)).toBeNull();
    expect(resolveTsImport("src/main.ts", "react", files)).toBeNull();
  });

  it("Rust: mod и use, элементы self пропускаются", () => {
    expect(extractRustModuleRefs("mod util;\npub mod api;\nuse crate::util::helper;\nuse self::inner::X;")).toEqual([
      { kind: "mod", path: ["util"] },
      { kind: "mod", path: ["api"] },
      { kind: "use", path: ["crate", "util", "helper"] },
      { kind: "use", path: ["inner", "X"] }
    ]);
  });
});

describe("сравнение проектной схемы с фактом", () => {
  it("находит вставленную лишнюю связь и неописанную связь в коде", async () => {
    const { nodes, edges } = await analyzeRepository({ rootPath: root });
    const project: ArchitectProjectSchema = {
      nodes: nodes.map((node) => ({ id: node.id, name: node.name, kind: node.kind, path: node.path })),
      edges: [
        ...edges.map((edge) => ({ from: edge.from, to: edge.to, kind: "import" as const })),
        { from: "apps/web/index.ts", to: "apps/web/ghost.ts", kind: "import" }
      ]
    };
    const comparison = compareArchitectSchemas("repo-1", project, {
      nodes: nodes.map((node) => ({ id: node.id, kind: node.kind })),
      edges: edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }))
    });
    expect(comparison.repositoryId).toBe("repo-1");
    expect(comparison.counts.extraEdges).toBe(1);
    expect(comparison.issues.find((issue) => issue.kind === "extra_edge")).toMatchObject({
      from: "apps/web/index.ts",
      to: "apps/web/ghost.ts"
    });
    expect(comparison.counts.missingEdges).toBe(0);
    expect(comparison.counts.missingNodes).toBe(0);
  });
});
