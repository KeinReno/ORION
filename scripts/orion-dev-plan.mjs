import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Pure dry-run planner: no network access, credentials, or writes. */
export function planOrionDevImport(catalog, snapshot = {}) {
  if (catalog?.schemaVersion !== 1 || catalog.catalogId !== "orion-dev") {
    throw new Error("Unsupported ORION DEV catalog");
  }
  const projects = catalog.projects;
  const items = catalog.workItems;
  if (!Array.isArray(projects) || !Array.isArray(items)) throw new Error("Invalid catalog arrays");
  const unique = (rows, label) => {
    const seen = new Set();
    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id || seen.has(row.id)) {
        throw new Error("Invalid or duplicate " + label + " ID");
      }
      seen.add(row.id);
    }
    return seen;
  };
  const phases = catalog.phases ?? [];
  if (!Array.isArray(phases)) throw new Error("Invalid catalog phases");
  const phaseIds = unique(phases, "phase");
  const byPhase = new Map(phases.map((phase) => [phase.id, phase]));
  for (const phase of phases) {
    for (const dependency of phase.dependsOn ?? []) {
      if (!phaseIds.has(dependency)) throw new Error("Unknown phase dependency: " + dependency);
    }
  }
  const activePhases = new Set();
  const completedPhases = new Set();
  function checkPhase(id) {
    if (activePhases.has(id)) throw new Error("Phase dependency cycle: " + id);
    if (completedPhases.has(id)) return;
    activePhases.add(id);
    for (const dep of byPhase.get(id).dependsOn ?? []) checkPhase(dep);
    activePhases.delete(id);
    completedPhases.add(id);
  }
  for (const id of phaseIds) checkPhase(id);
  for (const project of projects) {
    if (project.phase && !phaseIds.has(project.phase)) throw new Error("Unknown project phase: " + project.phase);
  }
  for (const item of items) {
    if (item.phase && !phaseIds.has(item.phase)) throw new Error("Unknown task phase: " + item.phase);
  }
  const projectIds = unique(projects, "project");
  const taskIds = unique(items, "task");
  const byTask = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (!projectIds.has(item.project)) throw new Error("Unknown project: " + item.project);
    for (const dep of item.dependsOn ?? []) {
      if (!taskIds.has(dep)) throw new Error("Unknown dependency: " + dep);
    }
  }
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error("Dependency cycle: " + id);
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of byTask.get(id).dependsOn ?? []) visit(dep);
    active.delete(id);
    visited.add(id);
  }
  for (const id of taskIds) visit(id);

  const existingProjects = snapshot.projects ?? [];
  const existingTasks = snapshot.tasks ?? [];
  const workspaces = snapshot.workspaces ?? [];
  if (!Array.isArray(workspaces)) throw new Error("Invalid snapshot workspaces");
  const normalize = (value) => String(value ?? "").trim().toLowerCase();
  const matches = workspaces.filter((row) => normalize(row.name) === "orion dev");
  if (matches.length > 1) throw new Error("Ambiguous ORION DEV workspace");
  const workspace = matches[0] ?? null;
  const mappings = snapshot.mappings ?? [];
  if (!Array.isArray(mappings)) throw new Error("Invalid snapshot mappings");
  const mappedKeys = new Set();
  const mappedTargets = new Set();
  for (const m of mappings) {
    if (m.catalogId !== catalog.catalogId) continue;
    if (!["project", "task"].includes(m.kind) || typeof m.externalId !== "string" || !m.externalId || typeof m.entityId !== "string" || !m.entityId || typeof m.workspaceId !== "string" || !m.workspaceId) throw new Error("Invalid mapping");
    if (!workspace || m.workspaceId !== workspace.id) throw new Error("Foreign or unresolved workspace mapping: " + m.externalId);
    if (m.kind === "project" && !projectIds.has(m.externalId)) throw new Error("Unknown mapped project: " + m.externalId);
    if (m.kind === "task" && !taskIds.has(m.externalId)) throw new Error("Unknown mapped task: " + m.externalId);
    const key = m.kind + ":" + m.externalId;
    const target = m.kind + ":" + m.entityId;
    if (mappedKeys.has(key) || mappedTargets.has(target)) throw new Error("Duplicate mapping");
    mappedKeys.add(key); mappedTargets.add(target);
  }
  const mappingFor = (kind, id) => mappings.find((m) => m.catalogId === catalog.catalogId && m.kind === kind && m.externalId === id);
  for (const rows of [workspaces, existingProjects, existingTasks]) {
    if (!Array.isArray(rows)) throw new Error("Invalid snapshot");
  }
  const actions = [];
  if (!workspace) actions.push({ kind: "workspace", action: "propose_create", name: "ORION DEV" });
  else actions.push({ kind: "workspace", action: "review_possible_match", candidateId: workspace.id, reason: "Name match is not durable ownership; explicit confirmation required" });

  for (const project of projects) {
    const candidates = workspace
      ? existingProjects.filter((row) => row.workspaceId === workspace.id && normalize(row.name) === normalize(project.title))
      : [];
    if (candidates.length > 1) throw new Error("Ambiguous project: " + project.title);
    const mapped = mappingFor("project", project.id);
    const mappedProject = mapped ? existingProjects.find((p) => p.id === mapped.entityId && p.workspaceId === workspace?.id) : null;
    if (mapped && !mappedProject) throw new Error("Stale project mapping: " + project.id);
    if (mappedProject && candidates.length && candidates[0].id !== mappedProject.id) {
      throw new Error("Conflicting project name and mapping: " + project.id);
    }
    const matched = mappedProject ?? candidates[0] ?? null;
    actions.push({
      kind: "project", externalId: project.id, name: project.title,
      action: mappedProject ? "already_mapped" : matched ? "confirm_existing" : "propose_create",
      candidateId: matched?.id ?? null
    });
    for (const item of items.filter((row) => row.project === project.id)) {
      const possible = matched
        ? existingTasks.filter((row) => row.workspaceId === workspace.id &&
            row.projectId === matched.id && normalize(row.title) === normalize(item.title))
        : [];
      const mappedTask = mappingFor("task", item.id);
      const resolvedTask = mappedTask ? existingTasks.find((t) => t.id === mappedTask.entityId && t.workspaceId === workspace?.id && t.projectId === matched?.id) : null;
      if (mappedTask && !resolvedTask) throw new Error("Stale task mapping: " + item.id);
      if (resolvedTask && possible.some((candidate) => candidate.id !== resolvedTask.id)) {
        throw new Error("Conflicting task name and mapping: " + item.id);
      }
      actions.push({
        kind: "task", externalId: item.id, projectExternalId: project.id,
        title: item.title, dependsOn: item.dependsOn ?? [],
        action: resolvedTask ? "already_mapped" : possible.length ? "review_possible_match" : "propose_create",
        candidateIds: possible.map((row) => row.id)
      });
    }
  }
  return {
    mode: "dry-run", catalogId: catalog.catalogId, workspaceId: workspace?.id ?? null,
    warning: "No writes. Name matches are not durable identity mappings.",
    actions
  };
}

const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalog = JSON.parse(readFileSync(resolve(process.argv[2] ?? resolve(here, "../development/orion-dev.catalog.json")), "utf8"));
  const snapshot = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), "utf8")) : {};
  process.stdout.write(JSON.stringify(planOrionDevImport(catalog, snapshot), null, 2) + "\n");
}
