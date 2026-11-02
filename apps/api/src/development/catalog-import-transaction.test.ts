import { describe, expect, it, vi } from "vitest";
import { applyConfirmedDevelopmentImportTx } from "./catalog-import-transaction";
import type { Prisma } from "@prisma/client";

describe("confirmed development import declaration validation", () => {
  it.each(["project", "task"] as const)(
    "rejects duplicate %s external IDs before any database write",
    async (kind) => {
      const tx = {
        developmentCatalogMapping: { findMany: vi.fn(), create: vi.fn() },
        project: { create: vi.fn() },
        task: { create: vi.fn() }
      };
      const project = { externalId: "core", title: "Core" };
      const task = { externalId: "DEV-001", projectExternalId: "core", title: "Task" };
      const input = {
        workspaceId: "w", catalogId: "orion-dev", workspaceConfirmed: true as const,
        projects: kind === "project" ? [project, project] : [project],
        tasks: kind === "task" ? [task, task] : [task],
        dependencies: kind === "task"
          ? [{ externalId: "DEV-001", dependsOn: [] }, { externalId: "DEV-001", dependsOn: [] }]
          : [{ externalId: "DEV-001", dependsOn: [] }]
      };
      await expect(applyConfirmedDevelopmentImportTx(
        tx as unknown as Prisma.TransactionClient, "user", input
      )).rejects.toThrow(/Duplicate or missing/);
      expect(tx.project.create).not.toHaveBeenCalled();
      expect(tx.task.create).not.toHaveBeenCalled();
      expect(tx.developmentCatalogMapping.create).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { externalId: "DEV-001", dependsOn: null },
    { externalId: "DEV-001", dependsOn: "DEV-002" },
    { externalId: "DEV-001", dependsOn: [null] }
  ])("rejects malformed dependency rows before database writes: %j", async (dependency) => {
    const tx = {
      developmentCatalogMapping: { findMany: vi.fn(), create: vi.fn() },
      project: { create: vi.fn() },
      task: { create: vi.fn() }
    };
    const input = {
      workspaceId: "w", catalogId: "orion-dev", workspaceConfirmed: true as const,
      projects: [{ externalId: "core", title: "Core" }],
      tasks: [{ externalId: "DEV-001", projectExternalId: "core", title: "Task" }],
      dependencies: [dependency]
    };
    await expect(applyConfirmedDevelopmentImportTx(
      tx as unknown as Prisma.TransactionClient, "user",
      input as unknown as Parameters<typeof applyConfirmedDevelopmentImportTx>[2]
    )).rejects.toThrow(/Incomplete development import declarations/);
    expect(tx.project.create).not.toHaveBeenCalled();
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.developmentCatalogMapping.create).not.toHaveBeenCalled();
  });

});
