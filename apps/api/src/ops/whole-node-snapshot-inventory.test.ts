import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classifyWholeNodeManifestTables } from "./whole-node-snapshot-inventory";
import { SNAPSHOT_MODEL_REGISTRY, type SnapshotPolicy } from "../sync/snapshot-registry";

const policies: SnapshotPolicy[] = ["included", "derived", "identity-excluded", "secret-excluded", "ephemeral-excluded"];

describe("whole-node snapshot classification inventory", () => {
  it("aggregates every Prisma physical table by its existing snapshot policy", () => {
    const dmmfModels = Prisma.dmmf.datamodel.models;
    const expected = Object.fromEntries(policies.map((policy) => [policy, 0])) as Record<SnapshotPolicy, number>;
    for (const model of dmmfModels) {
      const classifications = SNAPSHOT_MODEL_REGISTRY.filter((entry) => entry.model === model.name);
      expect(classifications).toHaveLength(1);
      expected[classifications[0]!.policy] += 1;
    }

    const result = classifyWholeNodeManifestTables(dmmfModels.map((model) => model.dbName ?? model.name));
    expect(result.status).toBe("classified");
    expect(result.categories).toEqual(expected);
    expect(result.unknown).toBe(0);
    expect(result.tablesSeen).toBe(dmmfModels.length);
  });

  it("uses DMMF database table names when a Prisma model is mapped", () => {
    const model = Prisma.dmmf.datamodel.models.find((entry) => entry.dbName && entry.dbName !== entry.name);
    expect(model).toBeDefined();
    const policy = SNAPSHOT_MODEL_REGISTRY.find((entry) => entry.model === model!.name)!.policy;
    const result = classifyWholeNodeManifestTables([model!.dbName!]);
    expect(result.categories[policy]).toBe(1);
    expect(result.unknown).toBe(0);
  });

  it("fails closed for unknown tables without returning their names", () => {
    const result = classifyWholeNodeManifestTables(["unregistered_table", "person@example.invalid"]);
    expect(result.status).toBe("unknown-tables");
    expect(result.unknown).toBe(2);
    expect(Object.values(result.categories).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(JSON.stringify(result)).not.toContain("unregistered_table");
    expect(JSON.stringify(result)).not.toContain("person@example.invalid");
  });

  it("does not imply permission to restore a whole-node backup", () => {
    const result = classifyWholeNodeManifestTables(["users"]);
    expect(result.restoreAuthorized).toBe(false);
    expect(result.notice).toMatch(/не разрешает/i);
  });
});
