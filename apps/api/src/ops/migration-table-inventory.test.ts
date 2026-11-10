import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { inspectMigrationTableInventory } from "./migration-table-inventory";
import { SNAPSHOT_MODEL_REGISTRY } from "../sync/snapshot-registry";

describe("whole-node migration table policy inventory", () => {
  const currentTables = Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name);

  it("accounts for every current table and blocks pass-through without a migration disposition", () => {
    const inventory = inspectMigrationTableInventory(currentTables);

    expect(inventory.status).toBe("blocked");
    expect(inventory.unknownTables).toBe(0);
    expect(inventory.missingTables).toBe(0);
    expect(inventory.ambiguousModels).toBe(0);
    expect(inventory.unparsedPolicies).toBe(0);
    expect(inventory.tablesWithMigrationDisposition).toBeGreaterThan(0);
    expect(inventory.tablesWithoutMigrationDisposition).toBeGreaterThan(0);
    expect(inventory.tablesSeen).toBe(inventory.tablesWithMigrationDisposition + inventory.tablesWithoutMigrationDisposition);
    expect(inventory.restoreAuthorized).toBe(false);
  });

  it("blocks unknown tables and models missing from the archive", () => {
    const inventory = inspectMigrationTableInventory(["workspaces", "unregistered_table"]);

    expect(inventory.status).toBe("blocked");
    expect(inventory.unknownTables).toBe(1);
    expect(inventory.missingTables).toBeGreaterThan(0);
    expect(inventory.restoreAuthorized).toBe(false);
  });

  it("blocks duplicate physical table mappings and duplicate or unknown policies", () => {
    const models = [{ name: "One", dbName: "shared" }, { name: "Two", dbName: "shared" }];
    const policies = [
      { model: "One", policy: "included" },
      { model: "One", policy: "identity-excluded" },
      { model: "Two", policy: "made-up-policy" }
    ];
    const inventory = inspectMigrationTableInventory(["shared"], models, policies);

    expect(inventory.status).toBe("blocked");
    expect(inventory.ambiguousModels).toBe(1);
    expect(inventory.unparsedPolicies).toBe(2);
    expect(inventory.unknownTables).toBe(1);
  });

  it("does not treat workspace snapshot policy as migration authorization", () => {
    expect(SNAPSHOT_MODEL_REGISTRY.length).toBeGreaterThan(0);
    const inventory = inspectMigrationTableInventory(currentTables);
    expect(inventory.restoreAuthorized).toBe(false);
    expect(inventory.status).toBe("blocked");
  });

  it("keeps durable Hub profiles, assignments and event history while classifying credentials for removal", () => {
    const models = [
      { name: "AgentHubEvent", dbName: "agent_hub_events" },
      { name: "AgentHubAgentProfile", dbName: "agent_hub_agent_profiles" },
      { name: "AgentHubTaskAssignment", dbName: "agent_hub_task_assignments" },
      { name: "AgentHubAgentCredential", dbName: "agent_hub_agent_credentials" }
    ];
    const policies = [
      { model: "AgentHubEvent", policy: "included" },
      { model: "AgentHubAgentProfile", policy: "included" },
      { model: "AgentHubTaskAssignment", policy: "included" },
      { model: "AgentHubAgentCredential", policy: "secret-excluded" }
    ];
    const inventory = inspectMigrationTableInventory(models.map((model) => model.dbName), models, policies);

    expect(inventory.status).toBe("classified");
    expect(inventory.dispositions.preserve).toBe(3);
    expect(inventory.dispositions["sanitize-side-effects"]).toBe(1);
    expect(inventory.tablesWithoutMigrationDisposition).toBe(0);
    expect(inventory.restoreAuthorized).toBe(false);
  });
});
