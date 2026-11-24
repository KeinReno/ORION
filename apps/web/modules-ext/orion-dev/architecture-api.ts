import { createModuleClient, workspaceModuleBase, type ModuleRequester } from "@orion/core";
import {
  architectureDiagramSchema,
  architectureDiagramSummarySchema,
  createArchitectureDiagramInputSchema,
  updateArchitectureDiagramInputSchema,
  type ArchitectureDiagram,
  type ArchitectureDiagramSummary,
  type CreateArchitectureDiagramInput,
  type UpdateArchitectureDiagramInput
} from "@orion/shared-types";
import { architectMapSchema, developmentRepositorySchema, type ArchitectMap, type DevelopmentRepository } from "@orion/shared-types";
import { z } from "zod";

export type ArchitectCodeTarget = { repositoryId: string; path: string };

const createdSchema = z.object({ id: z.string() });

export interface ArchitectureDiagramsClient {
  list(): Promise<ArchitectureDiagramSummary[]>;
  repositories(): Promise<DevelopmentRepository[]>;
  create(input: CreateArchitectureDiagramInput): Promise<{ id: string }>;
  get(id: string): Promise<ArchitectureDiagram>;
  update(id: string, input: UpdateArchitectureDiagramInput): Promise<ArchitectureDiagram>;
  remove(id: string): Promise<unknown>;
  /** Карта репозитория: модули и каталоги верхнего уровня, без тысяч файлов на холсте. */
  codeModules(repositoryId: string): Promise<ArchitectMap>;
}

export function createArchitectureDiagramsClient(api: ModuleRequester, workspaceId: string): ArchitectureDiagramsClient {
  const client = createModuleClient(api, workspaceModuleBase(workspaceId, "development/architect/diagrams"));
  const gitClient = createModuleClient(api, workspaceModuleBase(workspaceId, "development/git"));
  const architectClient = createModuleClient(api, workspaceModuleBase(workspaceId, "development/architect"));
  return {
    list: () => client.get("", architectureDiagramSummarySchema.array()),
    repositories: () => gitClient.get("/repositories", developmentRepositorySchema.array()),
    create: input => client.post("", input, createdSchema),
    get: id => client.get(`/${encodeURIComponent(id)}`, architectureDiagramSchema),
    update: (id, input) => client.put(`/${encodeURIComponent(id)}`, input, architectureDiagramSchema),
    remove: id => client.delete(`/${encodeURIComponent(id)}`, z.unknown()),
    codeModules: repositoryId => architectClient.get(`/${encodeURIComponent(repositoryId)}/map`, architectMapSchema)
  };
}

export { createArchitectureDiagramInputSchema, updateArchitectureDiagramInputSchema };
