import { describe, expect, it } from "vitest";
import {
  architectureCodeNeighborhood,
  architectureDiagramExportSchema,
  architectureNodeSchema,
  coerceArchitectureGraph,
  createArchitectureDiagramInputSchema,
  updateArchitectureDiagramInputSchema
} from "./development-architecture";

const node = {
  id: "api-1", kind: "part", title: "Шлюз", purpose: "Единая точка входа.",
  x: 10, y: 20, parentId: null, binding: null
} as const;

describe("authored Architect diagrams", () => {
  it("принимает часть системы и отвергает путь вне репозитория", () => {
    expect(architectureNodeSchema.safeParse(node).success).toBe(true);
    expect(architectureNodeSchema.safeParse({ ...node, binding: { path: "apps/api/src/main.ts" } }).success).toBe(true);
    expect(architectureNodeSchema.safeParse({ ...node, binding: { path: "../../private.txt" } }).success).toBe(false);
    expect(architectureNodeSchema.safeParse({ ...node, kind: "sticker" }).success).toBe(false);
  });

  it("старый каталог типов читается как части и зависимость", () => {
    const graph = coerceArchitectureGraph(
      [{ id: "gateway", category: "software_components", type: "api", title: "Gateway", description: "Вход", meta: "edge", x: 1, y: 2, parentId: null, reference: { path: "apps/api/src/main.ts" } }],
      [{ id: "e1", source: "gateway", target: "missing", kind: "calls", label: "" }]
    );
    expect(graph.nodes).toEqual([{ id: "gateway", kind: "part", title: "Gateway", purpose: "Вход\nedge", x: 1, y: 2, parentId: null, binding: { path: "apps/api/src/main.ts" } }]);
    expect(graph.edges).toEqual([]);
  });

  it("окрестность файла — исходящие импорты и кто ссылается снаружи", () => {
    const neighborhood = architectureCodeNeighborhood("apps/api/src/notes", [
      { from: "apps/api/src/notes/notes.service.ts", to: "apps/api/src/notes/notes.module.ts", external: false },
      { from: "apps/api/src/notes/notes.service.ts", to: "external:@nestjs/common", external: true },
      { from: "apps/api/src/tasks/tasks.service.ts", to: "apps/api/src/notes/notes.service.ts", external: false },
      { from: "apps/api-extra/src/index.ts", to: "apps/api/src/main.ts", external: false }
    ]);
    expect(neighborhood.seen).toBe(true);
    expect(neighborhood.dependsOn.map(link => link.path)).toEqual(["external:@nestjs/common"]);
    expect(neighborhood.usedBy.map(link => link.path)).toEqual(["apps/api/src/tasks/tasks.service.ts"]);
  });

  it("отвергает висящую связь и экспорт без ревизии", () => {
    const input = {
      name: "Шлюз",
      description: "",
      graph: {
        nodes: [node],
        edges: [{ id: "edge-1", source: "api-1", target: "missing", sourceHandle: "out", targetHandle: "in", kind: "depends", label: "" }],
        viewport: null
      },
      expectedRevision: 1
    };
    expect(updateArchitectureDiagramInputSchema.safeParse(input).success).toBe(false);
    expect(createArchitectureDiagramInputSchema.safeParse({ name: "Новая схема" }).success).toBe(true);
    expect(architectureDiagramExportSchema.safeParse({ format: "orion-architecture", version: 1, diagram: { ...input.graph, ...input, id: "d1", nodeCount: 1, edgeCount: 0, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }).success).toBe(false);
  });
});
