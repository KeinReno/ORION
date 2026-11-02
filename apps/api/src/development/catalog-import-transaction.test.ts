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
});
