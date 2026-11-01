import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDevelopmentCatalog } from "./catalog-loader";

const roots: string[] = [];
function fixture(data: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "orion-catalog-"));
  roots.push(root);
  mkdirSync(join(root, "development"));
  writeFileSync(join(root, "development", "orion-dev.catalog.json"),
    typeof data === "string" ? data : JSON.stringify(data));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const minimal = {
  schemaVersion: 1, catalogId: "orion-dev",
  phases: [{ id: "foundation" }],
  projects: [{ id: "core", title: "ORION CORE" }],
  workItems: [{ id: "DEV-001", project: "core", title: "Review core" }]
};

describe("fixed-source development catalog loader", () => {
  it("loads supported catalog and emits stable content digest", () => {
    const root = fixture(minimal);
    const first = loadDevelopmentCatalog(root);
    expect(first.catalog.catalogId).toBe("orion-dev");
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loadDevelopmentCatalog(root).sha256).toBe(first.sha256);
    writeFileSync(join(root, "development", "orion-dev.catalog.json"),
      JSON.stringify({ ...minimal, title: "changed" }));
    expect(loadDevelopmentCatalog(root).sha256).not.toBe(first.sha256);
  });
  it("rejects missing, malformed and unsupported catalogs", () => {
    expect(() => loadDevelopmentCatalog(join(tmpdir(), "nonexistent-orion-catalog-root"))).toThrow();
    expect(() => loadDevelopmentCatalog(fixture("{"))).toThrow();
    expect(() => loadDevelopmentCatalog(fixture({ ...minimal, schemaVersion: 2 }))).toThrow();
    expect(() => loadDevelopmentCatalog(fixture({ ...minimal, catalogId: "foreign" }))).toThrow();
    expect(() => loadDevelopmentCatalog(fixture({ ...minimal, phases: [{ id: "x" }, { id: "x" }] }))).toThrow();
  });
});
