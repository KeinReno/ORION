import type { Project } from "@orion/shared-types";

/** Uses the canonical project progress and registered owner aggregates. */
export abstract class ProjectCatalog {
  abstract list(userId: string, workspaceId: string, archived?: boolean): Promise<Project[]>;
}
