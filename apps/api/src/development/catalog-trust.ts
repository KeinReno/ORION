import { ConflictException } from "@nestjs/common";
import type { ConfirmedDevelopmentImport } from "./catalog-import-transaction";
import { developmentDescription } from "./catalog-description";

export interface TrustedDevelopmentCatalog {
  schemaVersion?: 1;
  phases?: readonly { id: string; dependsOn?: readonly string[] }[];
  catalogId: string;
  projects: readonly { id: string; title: string; phase?: string }[];
  workItems: readonly {
    id: string;
    project: string;
    phase?: string;
    title: string;
    acceptance?: readonly string[];
    dependsOn?: readonly string[];
  }[];
}

/**
 * Compare every submitted import declaration to a server-owned catalog.
 * Explicit existing-ID confirmations are allowed, but catalog content,
 * ordering and dependency declarations are never client-controlled.
 * Must run before any transaction writes.
 */
export function assertTrustedCatalogImport(
  catalog: TrustedDevelopmentCatalog,
  input: ConfirmedDevelopmentImport
): void {
  if (!catalog || !input || !catalog.catalogId || catalog.catalogId !== input.catalogId ||
      !Array.isArray(catalog.projects) || !Array.isArray(catalog.workItems) ||
      !Array.isArray(input.projects) || !Array.isArray(input.tasks) ||
      !Array.isArray(input.dependencies)) {
    throw new ConflictException("Catalog import does not match trusted catalog");
  }
  const projects = new Map<string, string>();
  const tasks = new Map<string, { project: string; title: string; dependencies: readonly string[] }>();
  for (const project of catalog.projects) {
    if (!project || typeof project.id !== "string" || !project.id ||
        typeof project.title !== "string" || !project.title.trim() || projects.has(project.id)) {
      throw new ConflictException("Invalid trusted catalog projects");
    }
    projects.set(project.id, project.title);
  }
  for (const task of catalog.workItems) {
    if (!task || typeof task.id !== "string" || !task.id ||
        typeof task.title !== "string" || !task.title.trim() ||
        !projects.has(task.project) || tasks.has(task.id) ||
        (task.dependsOn !== undefined && !Array.isArray(task.dependsOn))) {
      throw new ConflictException("Invalid trusted catalog tasks");
    }
    const dependencies = task.dependsOn ?? [];
    if (dependencies.some((id: unknown) => typeof id !== "string" || !id) ||
        new Set(dependencies).size !== dependencies.length) {
      throw new ConflictException("Invalid trusted catalog dependencies");
    }
    tasks.set(task.id, { project: task.project, title: task.title, dependencies });
  }
  if (input.projects.length !== projects.size || input.tasks.length !== tasks.size ||
      input.dependencies.length !== tasks.size) {
    throw new ConflictException("Incomplete catalog import");
  }
  const seenProjects = new Set<string>();
  for (const project of input.projects) {
    const source = project && catalog.projects.find(row => row.id === project.externalId);
    if (!project || seenProjects.has(project.externalId) ||
        projects.get(project.externalId) !== project.title ||
        (project.description !== undefined && project.description !== developmentDescription(source!))) {
      throw new ConflictException("Project declaration differs from trusted catalog");
    }
    seenProjects.add(project.externalId);
  }
  const seenTasks = new Set<string>();
  for (const task of input.tasks) {
    const expected = task && tasks.get(task.externalId);
    if (!expected || seenTasks.has(task.externalId) ||
        task.projectExternalId !== expected.project || task.title !== expected.title ||
        (task.description !== undefined && task.description !== developmentDescription(catalog.workItems.find(row => row.id === task.externalId)!))) {
      throw new ConflictException("Task declaration differs from trusted catalog");
    }
    seenTasks.add(task.externalId);
  }
  const seenDependencies = new Set<string>();
  for (const declaration of input.dependencies) {
    const expected = declaration && tasks.get(declaration.externalId);
    if (!expected || seenDependencies.has(declaration.externalId) ||
        !Array.isArray(declaration.dependsOn) ||
        declaration.dependsOn.length !== expected.dependencies.length ||
        new Set(declaration.dependsOn).size !== expected.dependencies.length ||
        declaration.dependsOn.some((id: string) => !expected.dependencies.includes(id))) {
      throw new ConflictException("Dependency declaration differs from trusted catalog");
    }
    seenDependencies.add(declaration.externalId);
  }
  for (const task of tasks.values()) {
    if (task.dependencies.some((id) => !tasks.has(id))) {
      throw new ConflictException("Unknown trusted catalog dependency");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ConflictException("Trusted catalog dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasks.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of tasks.keys()) visit(id);
}
