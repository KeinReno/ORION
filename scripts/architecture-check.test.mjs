import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { architectureViolations, colorViolations, pluginCatalogViolations } from "./architecture-check.mjs";

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
    put(root, "packages/shared-types/src/plugins.ts", 'export const ORION_PLUGIN_IDS = ["alpha", "beta", "gamma"] as const;\n');
    put(root, "apps/web/lib/extensions/contracts.ts", 'export interface SlotContracts {\n  "tasks.views": X;\n  "notes.filters": Y;\n}\n');
    put(root, "apps/web/plugins/index.ts", 'contribute("tasks.views", { pluginId: "alpha", component: A });\n');
    put(root, "apps/api/src/beta.controller.ts", '@RequirePlugin("beta")\nexport class C {}\n');
    put(root, "apps/api/src/gamma.service.ts", 'const on = isPluginEnabled(overrides, "gamma");\n');
    return root;
  }

  it("accepts a consistent catalog", () => {
    expect(pluginCatalogViolations(catalogFixture())).toEqual([]);
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
