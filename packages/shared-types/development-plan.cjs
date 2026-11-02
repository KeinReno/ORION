/** Pure dry-run planner: no network access, credentials, or writes. */
function planOrionDevImport(catalog, snapshot = {}) {
  if (catalog?.schemaVersion !== 1 || catalog.catalogId !== "orion-dev") {
    throw new Error("Unsupported ORION DEV catalog");
  }
  const projects = catalog.projects;
  const items = catalog.workItems;
  if (!Array.isArray(projects) || !Array.isArray(items)) throw new Error("Invalid catalog arrays");
  const unique = (rows, label) => {
    const seen = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id.trim() || seen.has(row.id)) {
        throw new Error("Invalid or duplicate " + label + " ID");
      }
      seen.add(row.id);
    }
    return seen;
  };
  const phases = catalog.phases ?? [];
  if (!Array.isArray(phases)) throw new Error("Invalid catalog phases");
  const phaseIds = unique(phases, "phase");
  const projectIds = unique(projects, "project");
  const taskIds = unique(items, "task");
  const byPhase = new Map(phases.map((phase) => [phase.id, phase]));
  for (const phase of phases) {
    if (phase.dependsOn !== undefined && !Array.isArray(phase.dependsOn)) throw new Error("Invalid phase dependencies: " + phase.id);
    if (new Set(phase.dependsOn ?? []).size !== (phase.dependsOn ?? []).length) throw new Error("Duplicate phase dependencies");
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
  // Project names are only hints for the first import. Duplicate catalog
  // titles make name-based review ambiguous even with unique external IDs.
  const projectTitles = new Set();
  for (const project of projects) {
    if (typeof project.title !== "string" || !project.title.trim()) {
      throw new Error("Invalid project title: " + project.id);
    }
    const normalizedTitle = project.title.trim().toLowerCase();
    if (projectTitles.has(normalizedTitle)) {
      throw new Error("Duplicate catalog project title: " + project.title);
    }
    projectTitles.add(normalizedTitle);
  }
  // Two catalog items with the same title in one project cannot be safely
  // matched to canonical tasks by name during an initial import.
  const normalizedTitles = new Set();
  for (const item of items) {
    if (typeof item.title !== "string" || !item.title.trim()) throw new Error("Invalid task title: " + item.id);
    const key = JSON.stringify([item.project, item.title.trim().toLowerCase()]);
    if (normalizedTitles.has(key)) throw new Error("Duplicate catalog task title: " + item.title);
    normalizedTitles.add(key);
  }
  const byTask = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    if (!projectIds.has(item.project)) throw new Error("Unknown project: " + item.project);
    if (item.dependsOn !== undefined && !Array.isArray(item.dependsOn)) throw new Error("Invalid task dependencies: " + item.id);
    if (new Set(item.dependsOn ?? []).size !== (item.dependsOn ?? []).length) throw new Error("Duplicate task dependencies");
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
  // Snapshot rows are untrusted input: ambiguous identities must never drive an import.
  for (const [label, rows] of [["workspace", workspaces], ["project", existingProjects], ["task", existingTasks]]) {
    if (!Array.isArray(rows)) throw new Error("Invalid snapshot " + label);
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) {
        throw new Error("Invalid or duplicate snapshot " + label + " ID");
      }
      ids.add(row.id);
    }
  }
  const normalize = (value) => String(value ?? "").trim().toLowerCase();
  // An explicit selection disambiguates same-named workspaces, but is still
  // only a dry-run candidate. It does not grant ownership or write permission.
  const targetWorkspaceId = snapshot.targetWorkspaceId;
  if (targetWorkspaceId !== undefined && (typeof targetWorkspaceId !== "string" || !targetWorkspaceId.trim())) {
    throw new Error("Invalid target workspace ID");
  }
  const matches = workspaces.filter((row) => normalize(row.name) === "orion dev");
  if (matches.length > 1 && !targetWorkspaceId) throw new Error("Ambiguous ORION DEV workspace");
  const workspace = targetWorkspaceId
    ? workspaces.find((row) => row.id === targetWorkspaceId)
    : matches[0];
  if (targetWorkspaceId && !workspace) throw new Error("Unknown target workspace ID");
  if (workspace) {
    const projectIds = new Set(existingProjects.map(row => row.id));
    for (const row of [...existingProjects, ...existingTasks]) {
      if (row.workspaceId !== workspace.id) throw new Error("Invalid or foreign development preview entity");
    }
    for (const task of existingTasks) {
      if (task.projectId != null && !projectIds.has(task.projectId)) throw new Error("Orphaned development preview task");
    }
  }
  const mappings = snapshot.mappings ?? [];
  if (!Array.isArray(mappings)) throw new Error("Invalid snapshot mappings");
  const mappedKeys = new Set();
  const mappedTargets = new Set();
  for (const m of mappings) {
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("Invalid mapping");
    if (m.catalogId !== catalog.catalogId) throw new Error("Foreign development catalog mapping");
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
      kind: "project", externalId: project.id, name: project.title, title: project.title,
      action: mappedProject ? "already_mapped" : matched ? "review_possible_match" : "propose_create",
      candidateId: matched?.id ?? null
    });
    for (const item of items.filter((row) => row.project === project.id)) {
      const possible = matched
        ? existingTasks.filter((row) => row.workspaceId === workspace.id &&
            row.projectId === matched.id && normalize(row.title) === normalize(item.title))
        : [];
      if (possible.length > 1) throw new Error("Ambiguous task: " + item.title);
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
        candidateId: resolvedTask?.id ?? possible[0]?.id ?? null,
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

exports.planOrionDevImport = planOrionDevImport;
