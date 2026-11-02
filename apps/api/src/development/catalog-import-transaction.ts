import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { importConfirmedCatalogProjectsTx, type ConfirmedCatalogProject } from "./catalog-project-import";
import { importConfirmedCatalogTasksTx, type ConfirmedCatalogTask } from "./catalog-task-import";
import { linkCatalogTaskDependenciesTx, type CatalogTaskDependencies } from "./catalog-task-dependencies";

export interface ConfirmedDevelopmentImport {
  workspaceId: string;
  catalogId: string;
  /** Server-generated confirmation token must be checked by the caller. */
  workspaceConfirmed: true;
  projects: readonly ConfirmedCatalogProject[];
  tasks: readonly ConfirmedCatalogTask[];
  dependencies: readonly CatalogTaskDependencies[];
}

/**
 * One atomic project -> task -> dependency operation.
 * INTERNAL ONLY: the caller must load a trusted, validated versioned catalog,
 * compare all submitted rows with it, verify an authenticated confirmation
 * token bound to the exact dry-run and workspace, and invoke inside withUser().
 * This function does not implement those external trust/consent checks.
 */
export async function applyConfirmedDevelopmentImportTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: ConfirmedDevelopmentImport
) {
  if (input.workspaceConfirmed !== true || !input.workspaceId || !input.catalogId ||
      !Array.isArray(input.projects) || !Array.isArray(input.tasks) ||
      !Array.isArray(input.dependencies)) {
    throw new ConflictException("Development import requires confirmed workspace and valid stages");
  }
  if (input.projects.some((project) => !project || typeof project.externalId !== "string") ||
      input.tasks.some((task) => !task || typeof task.externalId !== "string")) {
    throw new ConflictException("Duplicate or missing development import external IDs");
  }
  const projectIds = new Set(input.projects.map((project) => project.externalId));
  const taskIds = new Set(input.tasks.map((task) => task.externalId));
  if (projectIds.size !== input.projects.length || taskIds.size !== input.tasks.length ||
      input.projects.some((project) => !project.externalId) ||
      input.tasks.some((task) => !task.externalId)) {
    throw new ConflictException("Duplicate or missing development import external IDs");
  }
  if (input.tasks.some((task) => !projectIds.has(task.projectExternalId)) ||
      input.dependencies.length !== input.tasks.length ||
      input.dependencies.some((task) => !task || typeof task.externalId !== "string" ||
        !Array.isArray(task.dependsOn) || !taskIds.has(task.externalId) ||
        task.dependsOn.some((id) => typeof id !== "string" || !taskIds.has(id))) ||
      new Set(input.dependencies.map((task) => task.externalId)).size !== input.tasks.length) {
    throw new ConflictException("Incomplete development import declarations");
  }
  const projects = await importConfirmedCatalogProjectsTx(
    tx, userId, input.workspaceId, input.catalogId, input.projects
  );
  const tasks = await importConfirmedCatalogTasksTx(
    tx, userId, input.workspaceId, input.catalogId, input.tasks
  );
  const dependencies = await linkCatalogTaskDependenciesTx(
    tx, userId, input.workspaceId, input.catalogId, input.dependencies
  );
  return { projects, tasks, dependencies };
}
