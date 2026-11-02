import { ConflictException } from "@nestjs/common";
import type { ConfirmedDevelopmentImport } from "./catalog-import-transaction";
import { assertTrustedCatalogImport, type TrustedDevelopmentCatalog } from "./catalog-trust";
import { developmentDescription } from "./catalog-description";

export interface CatalogMatchConfirmations {
  /** Explicit user-reviewed canonical IDs, keyed by catalog external ID. */
  projects?: Readonly<Record<string, string>>;
  tasks?: Readonly<Record<string, string>>;
}

/**
 * Constructs import declarations exclusively from a trusted server catalog.
 * The caller supplies only workspace identity and reviewed existing-ID matches;
 * no project/task titles or dependency graph are accepted from the client.
 *
 * Internal builder, NOT an authorization or consent gate. Authenticate the
 * user, bind confirmations to a fresh dry-run and check their target IDs before
 * invoking the transactional importer.
 */
export function buildDevelopmentImport(
  catalog: TrustedDevelopmentCatalog,
  workspaceId: string,
  matches: CatalogMatchConfirmations = {}
): ConfirmedDevelopmentImport {
  if (!workspaceId || typeof workspaceId !== "string" ||
      !matches || typeof matches !== "object" || Array.isArray(matches)) {
    throw new ConflictException("Invalid development import selection");
  }
  const projectSelections = matches.projects ?? {};
  const taskSelections = matches.tasks ?? {};
  const validateSelections = (
    selections: Readonly<Record<string, string>>,
    allowedIds: ReadonlySet<string>
  ): void => {
    if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
      throw new ConflictException("Invalid existing entity confirmations");
    }
    const targets = new Set<string>();
    for (const [id, entityId] of Object.entries(selections)) {
      if (!allowedIds.has(id) || typeof entityId !== "string" || !entityId.trim() ||
          targets.has(entityId)) {
        throw new ConflictException("Unknown or duplicate existing entity confirmation");
      }
      targets.add(entityId);
    }
  };
  if (!catalog || !Array.isArray(catalog.projects) || !Array.isArray(catalog.workItems)) {
    throw new ConflictException("Invalid trusted catalog");
  }
  validateSelections(projectSelections, new Set(catalog.projects.map((project) => project.id)));
  validateSelections(taskSelections, new Set(catalog.workItems.map((task) => task.id)));
  const input: ConfirmedDevelopmentImport = {
    workspaceId, catalogId: catalog.catalogId, workspaceConfirmed: true,
    projects: catalog.projects.map((project) => ({
      externalId: project.id,
      title: project.title,
      description: developmentDescription(project),
      ...(projectSelections[project.id] ? { confirmedExistingId: projectSelections[project.id] } : {})
    })),
    tasks: catalog.workItems.map((task) => ({
      externalId: task.id,
      projectExternalId: task.project,
      title: task.title,
      description: developmentDescription(task),
      ...(taskSelections[task.id] ? { confirmedExistingId: taskSelections[task.id] } : {})
    })),
    dependencies: catalog.workItems.map((task) => ({
      externalId: task.id,
      dependsOn: [...(task.dependsOn ?? [])]
    }))
  };
  assertTrustedCatalogImport(catalog, input);
  return input;
}
