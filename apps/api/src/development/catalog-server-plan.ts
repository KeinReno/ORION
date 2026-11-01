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
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const projectIds = new Set(catalog.projects.map((project) => project.id));
  const taskIds = new Set(catalog.workItems.map((task) => task.id));
  const mappings = new Map<string, string>();
  const targets = new Set<string>();
  for (const mapping of snapshot.mappings) {
    if (mapping.workspaceId !== workspace.id || mapping.catalogId !== catalog.catalogId ||
        !["project", "task"].includes(mapping.kind)) {
      throw new ConflictException("Foreign development catalog mapping");
    }
    if ((mapping.kind === "project" && !projectIds.has(mapping.externalId)) ||
        (mapping.kind === "task" && !taskIds.has(mapping.externalId))) {
      throw new ConflictException("Unknown development catalog mapping");
    }
    const key = mapping.kind + ":" + mapping.externalId;
    const target = mapping.kind + ":" + mapping.entityId;
    if (mappings.has(key) || targets.has(target)) throw new ConflictException("Duplicate catalog mapping");
    mappings.set(key, mapping.entityId);
    targets.add(target);
  }
  const projectActions = catalog.projects.map((project) => {
    const existing = snapshot.projects.filter((row) =>
      row.workspaceId === workspace.id && normalize(row.name) === normalize(project.title));
    if (existing.length > 1) throw new ConflictException("Ambiguous project name");
    const mappedId = mappings.get("project:" + project.id);
    const mapped = mappedId ? snapshot.projects.find((row) =>
      row.id === mappedId && row.workspaceId === workspace.id) : undefined;
    if (mappedId && !mapped) throw new ConflictException("Stale project mapping");
    if (mapped && existing.length && existing[0]!.id !== mapped.id) {
      throw new ConflictException("Conflicting project mapping");
    }
    return {
      kind: "project" as const, externalId: project.id, title: project.title,
      action: mapped ? "already_mapped" : existing.length ? "review_possible_match" : "propose_create",
      candidateId: mapped?.id ?? existing[0]?.id ?? null
    };
  });
  const taskActions = catalog.workItems.map((task) => {
    const parent = projectActions.find((project) => project.externalId === task.project);
    const possible = parent?.candidateId ? snapshot.tasks.filter((row) =>
      row.workspaceId === workspace.id && row.projectId === parent.candidateId &&
      normalize(row.title) === normalize(task.title)) : [];
    if (possible.length > 1) throw new ConflictException("Ambiguous task name");
    const mappedId = mappings.get("task:" + task.id);
    const mapped = mappedId ? snapshot.tasks.find((row) =>
      row.id === mappedId && row.workspaceId === workspace.id &&
      row.projectId === parent?.candidateId) : undefined;
    if (mappedId && !mapped) throw new ConflictException("Stale task mapping");
    if (mapped && possible.length && possible[0]!.id !== mapped.id) {
      throw new ConflictException("Conflicting task mapping");
    }
    return {
      kind: "task" as const, externalId: task.id, projectExternalId: task.project,
      title: task.title, dependsOn: task.dependsOn ?? [],
      action: mapped ? "already_mapped" : possible.length ? "review_possible_match" : "propose_create",
      candidateId: mapped?.id ?? possible[0]?.id ?? null
    };
  });
  return {
    mode: "dry-run" as const, workspaceId: workspace.id, catalogId: catalog.catalogId,
    warning: "No writes. Name matches require explicit confirmation.",
    actions: [...projectActions, ...taskActions]
  };
}
