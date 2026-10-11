import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { architectureViolations } from "./architecture-check.mjs";

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

  it("keeps the office codec exception scoped to the documents-office plugin", () => {
    const root = fixture();
    put(root, "apps/web/lib/office/docx-codec.ts", "export const c = 1;");
    put(root, "apps/web/plugins/documents-office/docx-editor.tsx", 'import { c } from "../../lib/office/docx-codec";');
    expect(architectureViolations(root)).toEqual([]);
    put(root, "apps/web/plugins/sample/view.tsx", 'import { c } from "../../lib/office/docx-codec";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
  });

  it("rejects new office imports and registry imports outside the fixed allowlist", () => {
    const root = fixture();
    put(root, "apps/web/plugins/index.ts", 'import { x } from "../lib/office/office-kind";');
    expect(architectureViolations(root)).toEqual([]);
    put(root, "apps/web/plugins/index.ts", 'import { x } from "../lib/format";');
    expect(architectureViolations(root)).toEqual([expect.stringContaining("imports host internals")]);
    put(root, "apps/web/plugins/documents-office/new-editor.tsx", 'import { x } from "../../lib/office/docx-codec";');
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
