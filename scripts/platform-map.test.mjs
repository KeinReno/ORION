import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPlatformMap, platformMapProblems } from "./platform-map.mjs";

describe("generated platform capability map", () => {
  it("matches registries and cannot silently become stale", async () => {
    expect(await platformMapProblems()).toEqual([]);
    const map = await buildPlatformMap();
    expect(map.dataOwnership.modules.PetCarePet).toBe("modules-ext/pet-care");
    expect(map.registryEntryPoints).toContain("apps/api/src/common/entity-reference-registry.ts");
    expect(map.registryEntryPoints).toContain("apps/api/src/tasks/public/task-closure-registry.ts");
    expect(map.publicContracts).toContain("apps/api/src/tasks/public/task-closure-registry.ts");
    expect(map.publicContracts).toContain("apps/api/src/tasks/public/task-integration-reader.ts");
    expect(map.publicContracts).toContain("apps/api/src/tasks/public/task-integration-reader.module.ts");
    expect(map.publicContracts).toContain("apps/api/src/projects/public/project-finance-reader.ts");
    expect(map.publicContracts).toContain("apps/api/src/projects/public/project-finance-reader.module.ts");
    expect(map.publicContracts).toContain("apps/api/src/projects/public/project-references.ts");
    expect(map.publicContracts).toContain("apps/api/src/projects/public/project-references.module.ts");
    expect(map.publicContracts).toContain("apps/api/src/contacts/public/contact-references.ts");
    expect(map.publicContracts).toContain("apps/api/src/contacts/public/contact-references.module.ts");
    expect(map.publicContracts).toContain("packages/shared-types/src/component-manifest.ts");
    expect(map.uiSlots).toContain("tasks.views");
    const source = JSON.parse(readFileSync(new URL("../apps/api/src/modules-ext/pet-care/module.manifest.json", import.meta.url), "utf8"));
    expect(map.components.find(c => c.id === "pet-care").version).toBe(source.version);
    expect(map.components.find(c => c.id === "pet-care").dataModels).toContain("PetCarePet");
    expect(map.commands["create:module"]).toBeTruthy();
  });
});
