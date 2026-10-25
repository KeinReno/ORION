import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { architectureViolations, colorViolations, moduleBoundaryViolations, ownershipMapViolations, pluginCatalogViolations } from "./architecture-check.mjs";
import { MODULE_BOUNDARY_EXCEPTIONS } from "./module-boundary-exceptions.mjs";
import { CORE_MODELS, MODEL_OWNERS } from "./module-ownership.mjs";

const fixtures = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "orion-architecture-check-"));
  fixtures.push(root);
  for (const path of ["packages/core/src", "apps/api/src", "apps/web/lib/extensions", "apps/web/panels", "apps/web/plugins/sample"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  return root;
}
function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

afterEach(() => {
  const safeRoot = realpathSync(tmpdir()) + sep;
  for (const root of fixtures.splice(0)) {
    const actual = realpathSync(root);
    if (!actual.startsWith(safeRoot) || !actual.includes("orion-architecture-check-")) throw new Error("Unsafe test cleanup path");
    rmSync(actual, { recursive: true, force: true });
  }
});

describe("architecture import boundary", () => {
  it("rejects Base imports of a concrete plugin, including dynamic imports", () => {
    const root = fixture();
    put(root, "apps/web/panels/TasksPanel.tsx", 'import("../plugins/sample/view");\n');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports concrete plugin")]);
  });

  it("rejects a plugin importing its host panel", () => {
    const root = fixture();
    put(root, "apps/web/plugins/sample/view.tsx", 'import Panel from "../../panels/TasksPanel";\n');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host panel")]);
  });

  it("rejects a plugin reaching into host internals but allows the public host API", () => {
    const root = fixture();
    put(root, "apps/web/lib/format.ts", "export const x = 1;");
    put(root, "apps/web/lib/extensions/host-api.ts", 'export { x } from "../format";');
    put(root, "apps/web/plugins/sample/ok.tsx", 'import { x } from "../../lib/extensions/host-api";');
    expect(architectureViolations(root)).toEqual([]);
    put(root, "apps/web/plugins/sample/bad.tsx", 'import { x } from "../../lib/format";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
  });

  it("has no office codec exception: host lib imports are rejected, plugin-local codecs are fine", () => {
    const root = fixture();
    put(root, "apps/web/plugins/documents-office/codecs/docx-codec.ts", "export const c = 1;");
    put(root, "apps/web/plugins/documents-office/docx-editor.tsx", 'import { c } from "./codecs/docx-codec";');
    put(root, "apps/web/plugins/index.ts", 'import { c } from "./documents-office/codecs/docx-codec";');
    expect(architectureViolations(root)).toEqual([]);
    put(root, "apps/web/lib/office/docx-codec.ts", "export const c = 1;");
    put(root, "apps/web/plugins/documents-office/old-editor.tsx", 'import { c } from "../../lib/office/docx-codec";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
  });

  it("rejects registry imports of host internals and plugin-to-plugin codec imports", () => {
    const root = fixture();
    put(root, "apps/web/plugins/index.ts", 'import { x } from "../lib/format";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
    put(root, "apps/web/plugins/documents-office/codecs/docx-codec.ts", "export const c = 1;");
    put(root, "apps/web/plugins/sample/view.tsx", 'import { c } from "../documents-office/codecs/docx-codec";');
    expect(architectureViolations(root)).toHaveLength(2);
  });

  it("does not mistake extension internals for public plugin APIs", () => {
    const root = fixture();
    put(root, "apps/web/lib/extensions/slot.tsx", "export const x = 1;");
    put(root, "apps/web/plugins/sample/view.tsx", 'import { x } from "../../lib/extensions/slot";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
  });

  it("rejects direct imports across plugin folders", () => {
    const root = fixture();
    put(root, "apps/web/plugins/sample/view.tsx", 'import "../other/view";\n');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports another plugin")]);
  });

  it("allows registry composition but ignores import text in comments", () => {
    const root = fixture();
    put(root, "apps/web/lib/extensions/slot.tsx", 'import "../../plugins";\n');
    put(root, "packages/core/src/example.ts", '// import "../../../../apps/web/plugins/sample/view";\n');
    expect(architectureViolations(root)).toEqual([]);
  });
});

describe("plugin theme-token check", () => {
  it("flags hex, rgb() and palette-shade classes but not tokens or white/black overlays", () => {
    const root = fixture();
    put(root, "apps/web/plugins/sample/view.tsx", [
      'export const a = "text-red-500";',
      'export const b = { color: "#abc" };',
      'export const c = `rgba(0, 0, 0, .5)`;',
      'export const ok = "text-destructive bg-card hover:bg-white/5 border-border/60";'
    ].join("\n"));
    expect(colorViolations(root)).toHaveLength(3);
  });
});

describe("plugin catalog consistency (G23)", () => {
  function catalogFixture() {
    const root = fixture();
    put(root, "packages/shared-types/src/plugins.ts", 'export const CORE_PLUGIN_IDS = ["alpha", "beta", "gamma"] as const;\n');
    put(root, "apps/web/lib/extensions/contracts.ts", 'export interface SlotContracts {\n  "tasks.views": X;\n  "notes.filters": Y;\n}\n');
    put(root, "apps/web/plugins/index.ts", 'contribute("tasks.views", { pluginId: "alpha", component: A });\n');
    put(root, "apps/api/src/beta.controller.ts", '@RequirePlugin("beta")\nexport class C {}\n');
    put(root, "apps/api/src/gamma.service.ts", 'const on = isPluginEnabled(overrides, "gamma");\n');
    return root;
  }

  it("accepts a consistent catalog", () => {
    expect(pluginCatalogViolations(catalogFixture())).toEqual([]);
  });

  it("counts manifest-declared plugins (plugins-ext) as part of the catalog", () => {
    const root = catalogFixture();
    put(root, "packages/shared-types/src/plugins-ext/registry.generated.ts", 'export const GENERATED_PLUGIN_IDS = ["omega"] as const;\n');
    put(root, "apps/web/plugins-ext/contributions.generated.ts", 'contribute("notes.filters", { pluginId: "omega", component: O });\n');
    expect(pluginCatalogViolations(root)).toEqual([]);
    put(root, "apps/web/plugins-ext/contributions.generated.ts", 'contribute("notes.filters", { pluginId: "sigma", component: S });\n');
    expect(pluginCatalogViolations(root)).toEqual([
      expect.stringContaining('"sigma" зарегистрирован в вебе'),
      expect.stringContaining('плагин "omega" есть в PLUGIN_CATALOG')
    ]);
  });

  it("rejects a contribution to an unknown slot", () => {
    const root = catalogFixture();
    put(root, "apps/web/plugins/index.ts", 'contribute("tasks.viewz", { pluginId: "alpha", component: A });\n');
    expect(pluginCatalogViolations(root)).toEqual([expect.stringContaining('неизвестный слот "tasks.viewz"')]);
  });

  it("rejects a web plugin id missing from the catalog", () => {
    const root = catalogFixture();
    put(root, "apps/web/plugins/index.ts", 'contribute("tasks.views", { pluginId: "alpha", component: A });\ncontribute("notes.filters", { pluginId: "delta", component: D });\n');
    expect(pluginCatalogViolations(root)).toEqual([expect.stringContaining('"delta" зарегистрирован в вебе, но отсутствует в PLUGIN_CATALOG')]);
  });

  it("rejects a catalog plugin with neither web contribution nor server usage", () => {
    const root = catalogFixture();
    put(root, "apps/api/src/gamma.service.ts", "export const nothing = 1;\n");
    expect(pluginCatalogViolations(root)).toEqual([expect.stringContaining('плагин "gamma" есть в PLUGIN_CATALOG')]);
  });

  it("passes on the real repository", () => {
    expect(pluginCatalogViolations()).toEqual([]);
  });
});

// G4: сервис модуля не берёт чужие таблицы и не импортирует чужой сервис; долг — только из списка исключений.
describe("module boundary rule", () => {
  const NOTES = "apps/api/src/notes/notes.service.ts";
  const tasksUse = 'export class S { run(tx) { return tx.task.findMany({}); } }\n';

  it("separates manifest modules while allowing their own model and public contracts", () => {
    const root = fixture();
    const file = "apps/api/src/modules-ext/chat-archive/archive.service.ts";
    put(root, file, 'import { X } from "../pet-care/public/reader"; export class S { a(tx) { tx.chatArchiveConversation.findMany(); tx.workspaceMember.count(); } }');
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
    put(root, file, 'import { PetCareService } from "../pet-care/pet-care.service"; export class S { a(tx) { return tx.petCarePet.findMany(); } }');
    expect(moduleBoundaryViolations(root, {})).toEqual([
      expect.stringContaining("чужую модель PetCarePet"),
      expect.stringContaining("импортирует сервис другого модуля modules-ext/pet-care/pet-care.service")
    ]);
  });

  it("checks generated modules against base modules in both directions", () => {
    const root = fixture();
    put(root, NOTES, 'export class S { a(tx) { return tx.petCareDay.findMany(); } }');
    put(root, "apps/api/src/modules-ext/pet-care/reader.service.ts", tasksUse);
    expect(moduleBoundaryViolations(root, {})).toHaveLength(2);
  });

  it("allows a service to use its own models and core models", () => {
    const root = fixture();
    put(root, NOTES, "export class S { run(tx) { tx.note.create({}); tx.workspaceMember.findFirst({}); tx.entityLink.deleteMany({}); } }\n");
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
  });

  it("rejects another module's model, via tx and this.prisma", () => {
    const root = fixture();
    put(root, NOTES, "export class S { a(tx) { return tx.task.findMany({}); } b() { return this.prisma.transaction.count({}); } }\n");
    expect(moduleBoundaryViolations(root, {})).toEqual([
      expect.stringContaining("чужую модель Task"),
      expect.stringContaining("чужую модель Transaction")
    ]);
  });

  it("ignores same-named properties that are not Prisma delegates", () => {
    const root = fixture();
    put(root, NOTES, "export class S { a() { return this.tasks.findMany({}) && foo.task.findMany() && tx.task.someHelper(); } }\n");
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
  });

  it("rejects importing another domain module's service but not a core one or its own module's", () => {
    const root = fixture();
    put(root, NOTES, 'import { TasksService } from "../tasks/tasks.service";\nimport { WorkspacesService } from "../workspaces/workspaces.service";\nimport { X } from "./note-attachments.service";\n');
    expect(moduleBoundaryViolations(root, {})).toEqual([expect.stringContaining("импортирует сервис другого модуля tasks/tasks.service")]);
  });

  it("treats the opportunities directories as one module", () => {
    const root = fixture();
    put(root, "apps/api/src/opportunities-manager/m.service.ts", "export class S { a(tx) { return tx.opportunity.findMany({}); } }\n");
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
  });

  it("does not police core directories or tests", () => {
    const root = fixture();
    put(root, "apps/api/src/sync/snapshot.service.ts", tasksUse);
    put(root, "apps/api/src/notes/notes.service.test.ts", tasksUse);
    expect(moduleBoundaryViolations(root, {})).toEqual([]);
  });

  it("accepts a violation listed as an exception, but only that model", () => {
    const root = fixture();
    put(root, NOTES, 'export class S { a(tx) { return tx.task.findMany({}) && tx.event.count({}); } }\n');
    expect(moduleBoundaryViolations(root, { [NOTES]: { models: ["Task"] } })).toEqual([expect.stringContaining("чужую модель Event")]);
  });

  it("fails on a stale exception (model or service no longer used)", () => {
    const root = fixture();
    put(root, NOTES, tasksUse);
    const violations = moduleBoundaryViolations(root, { [NOTES]: { models: ["Task", "Event"], services: ["tasks/tasks.service"] } });
    expect(violations).toEqual([
      expect.stringContaining("исключение для модели Event устарело"),
      expect.stringContaining("исключение для сервиса tasks/tasks.service устарело")
    ]);
  });

  it("fails on a stale exception for a file that no longer violates anything", () => {
    const root = fixture();
    expect(moduleBoundaryViolations(root, { [NOTES]: { models: ["Task"] } })).toEqual([expect.stringContaining("исключение для модели Task устарело")]);
  });

  it("requires every schema model to have an owner", () => {
    const root = fixture();
    put(root, "apps/api/prisma/schema.prisma", "model Task {\n  id String\n}\nmodel Mystery {\n  id String\n}\n");
    expect(ownershipMapViolations(root)).toEqual([expect.stringContaining("модель Mystery")]);
  });

  it("passes on the real repository: every schema model is owned and the exception list is exact", () => {
    expect(ownershipMapViolations()).toEqual([]);
    expect(moduleBoundaryViolations()).toEqual([]);
    expect([...MODEL_OWNERS.keys()].filter((model) => CORE_MODELS.has(model))).toEqual([]);
  });

  it("keeps the projects module off other modules' tables (provider pattern)", () => {
    expect(Object.keys(MODULE_BOUNDARY_EXCEPTIONS)).not.toContain("apps/api/src/projects/projects.service.ts");
  });
});
