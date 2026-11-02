import { planOrionDevImport } from "@orion/shared-types/development-plan.cjs";
import { ConflictException } from "@nestjs/common";
import { buildDevelopmentImport } from "./catalog-import-builder";
import type { TrustedDevelopmentCatalog } from "./catalog-trust";

export interface PreviewSnapshot {
  targetWorkspaceId: string;
  workspaces: readonly { id: string; name: string }[];
  projects: readonly { id: string; workspaceId: string; name: string }[];
  tasks: readonly { id: string; workspaceId: string; projectId: string | null; title: string }[];
  mappings: readonly { workspaceId: string; catalogId: string; kind: string; externalId: string; entityId: string }[];
}

/** Read-only plan for an explicitly selected workspace. Never auto-adopt name matches. */
export function planDevelopmentImport(catalog: TrustedDevelopmentCatalog, snapshot: PreviewSnapshot) {
  buildDevelopmentImport(catalog, snapshot.targetWorkspaceId);
  const workspace = snapshot.workspaces.find((row) => row.id === snapshot.targetWorkspaceId);
  if (!workspace || snapshot.workspaces.length !== 1) {
    throw new ConflictException("Development preview workspace is unresolved");
  }
  // Fail closed if a future snapshot adapter leaks cross-workspace entities or
  // repeats canonical IDs; a preview must not suggest adopting foreign rows.
  for (const rows of [snapshot.projects, snapshot.tasks]) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.id || row.workspaceId !== workspace.id || ids.has(row.id)) {
        throw new ConflictException("Invalid or foreign development preview entity");
      }
      ids.add(row.id);
    }
  }
  // Reject partial snapshots: a task's parent must be present in this workspace.
  const snapshotProjectIds = new Set(snapshot.projects.map((row) => row.id));
  for (const task of snapshot.tasks) {
    if (task.projectId !== null && !snapshotProjectIds.has(task.projectId)) {
      throw new ConflictException("Orphaned development preview task");
    }
  }
  try {
    const result = planOrionDevImport({ schemaVersion: 1, ...catalog }, snapshot);
    const actions = result.actions.filter(row => row.kind !== "workspace").map(row => ({
      kind: row.kind as "project" | "task", externalId: row.externalId!, title: row.title!,
      action: row.action, candidateId: row.candidateId ?? null,
      ...(row.kind === "task" ? { projectExternalId: row.projectExternalId!, dependsOn: row.dependsOn ?? [] } : {})
    }));
    return {
      mode: "dry-run" as const, workspaceId: workspace.id, catalogId: catalog.catalogId,
      warning: "No writes. Name matches require explicit confirmation.", actions
    };
  } catch (error) {
    throw new ConflictException(error instanceof Error ? error.message : "Invalid development preview");
  }
}
