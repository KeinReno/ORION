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
