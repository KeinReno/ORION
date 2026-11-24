import { z } from "zod";

/**
 * Авторская архитектура: части системы и их обязанности.
 * Пока кода нет, карточка заполняется замыслом. Путь в `binding` — та же часть, уже найденная в репозитории.
 * Старые схемы с каталогом из 17 типов читаются через `coerceArchitectureGraph`.
 */
const relativePath = z.string().min(1).max(2048).refine(
  path => !path.startsWith("/") && !path.startsWith("\\") && !/^[a-z]:/i.test(path) && !path.split(/[\\/]+/).includes(".."),
  "Укажите относительный путь внутри репозитория."
);

export const architecturePartKindSchema = z.enum(["part", "boundary"]);
export type ArchitecturePartKind = z.infer<typeof architecturePartKindSchema>;

export const architectureBindingSchema = z.object({
  repositoryId: z.string().min(1).max(120).optional(),
  path: relativePath
}).strict();
export type ArchitectureBinding = z.infer<typeof architectureBindingSchema>;

export const architectureNodeSchema = z.object({
  id: z.string().min(1).max(120),
  kind: architecturePartKindSchema,
  title: z.string().trim().min(1).max(160),
  /** Зачем эта часть нужна. Пустая строка — ещё не сформулировано. */
  purpose: z.string().max(1200),
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  parentId: z.string().min(1).max(120).nullable(),
  binding: architectureBindingSchema.nullable()
}).strict();
export type ArchitectureNode = z.infer<typeof architectureNodeSchema>;

export const architectureEdgeKindSchema = z.enum(["depends", "launches"]);
export type ArchitectureEdgeKind = z.infer<typeof architectureEdgeKindSchema>;

export const architectureEdgeSchema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  sourceHandle: z.string().max(80).nullable(),
  targetHandle: z.string().max(80).nullable(),
  kind: architectureEdgeKindSchema,
  label: z.string().max(120)
}).strict().refine(edge => edge.source !== edge.target, { message: "Нельзя связать узел с самим собой." });
export type ArchitectureEdge = z.infer<typeof architectureEdgeSchema>;

export const architectureViewportSchema = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.1).max(4) }).strict();
export type ArchitectureViewport = z.infer<typeof architectureViewportSchema>;

export const architectureDiagramSummarySchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), nodeCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative(),
  revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string()
}).strict();
export type ArchitectureDiagramSummary = z.infer<typeof architectureDiagramSummarySchema>;

export const architectureDiagramSchema = architectureDiagramSummarySchema.extend({
  nodes: z.array(architectureNodeSchema).max(5000),
  edges: z.array(architectureEdgeSchema).max(20000),
  viewport: architectureViewportSchema.nullable()
}).strict();
export type ArchitectureDiagram = z.infer<typeof architectureDiagramSchema>;

const architectureGraphSchema = z.object({
  nodes: z.array(architectureNodeSchema).max(5000),
  edges: z.array(architectureEdgeSchema).max(20000),
  viewport: architectureViewportSchema.nullable()
}).strict().superRefine((graph, ctx) => {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) ctx.addIssue({ code: "custom", path: ["nodes"], message: `Повторяется ID узла ${node.id}.` });
    ids.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) ctx.addIssue({ code: "custom", path: ["edges"], message: `Связь ${edge.id} указывает на отсутствующий узел.` });
  }
  for (const node of graph.nodes) {
    if (node.parentId && (node.parentId === node.id || !ids.has(node.parentId) || graph.nodes.find(item => item.id === node.parentId)?.kind !== "boundary")) {
      ctx.addIssue({ code: "custom", path: ["nodes"], message: `Контур для узла ${node.id} не найден.` });
    }
  }
});

export const createArchitectureDiagramInputSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(1200).optional() }).strict();
export type CreateArchitectureDiagramInput = z.infer<typeof createArchitectureDiagramInputSchema>;

export const updateArchitectureDiagramInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1200),
  graph: architectureGraphSchema,
  expectedRevision: z.number().int().positive()
}).strict();
export type UpdateArchitectureDiagramInput = z.infer<typeof updateArchitectureDiagramInputSchema>;

export const architectureDiagramExportSchema = z.object({ format: z.literal("orion-architecture"), version: z.literal(1), diagram: architectureDiagramSchema }).strict();

export type ArchitectureCodeLink = { path: string; external: boolean };

/** Окрестность части по рёбрам импорта: что уходит наружу и кто снаружи ссылается внутрь. */
export function architectureCodeNeighborhood(
  root: string,
  edges: ReadonlyArray<{ from: string; to: string; external: boolean }>
): { seen: boolean; dependsOn: ArchitectureCodeLink[]; usedBy: ArchitectureCodeLink[] } {
  const inside = (path: string) => path === root || path.startsWith(`${root}/`);
  const depends = new Map<string, ArchitectureCodeLink>();
  const used = new Map<string, ArchitectureCodeLink>();
  let seen = false;
  for (const edge of edges) {
    const fromIn = inside(edge.from);
    const toIn = !edge.external && inside(edge.to);
    if (fromIn || toIn) seen = true;
    if (fromIn && !toIn) depends.set(edge.to, { path: edge.to, external: edge.external });
    if (toIn && !fromIn) used.set(edge.from, { path: edge.from, external: false });
  }
  const byPath = (a: ArchitectureCodeLink, b: ArchitectureCodeLink) => a.path.localeCompare(b.path);
  return { seen, dependsOn: [...depends.values()].sort(byPath), usedBy: [...used.values()].sort(byPath) };
}

const legacyEdgeKind: Record<string, ArchitectureEdgeKind> = {
  depends_on: "depends", calls: "depends", reads: "depends", writes: "depends",
  publishes: "depends", subscribes: "depends", contains: "depends", flow: "depends", constrains: "depends",
  depends: "depends", launches: "launches"
};

/** Старая схема (каталог типов) и новая (часть / граница) приводятся к одному графу. */
export function coerceArchitectureGraph(nodes: unknown, edges: unknown): { nodes: ArchitectureNode[]; edges: ArchitectureEdge[] } {
  const coercedNodes = (Array.isArray(nodes) ? nodes : []).flatMap(item => {
    const node = coerceArchitectureNode(item);
    return node ? [node] : [];
  });
  const ids = new Set(coercedNodes.map(node => node.id));
  const boundaries = new Set(coercedNodes.filter(node => node.kind === "boundary").map(node => node.id));
  const normalized = coercedNodes.map(node => node.parentId && boundaries.has(node.parentId) && node.parentId !== node.id ? node : { ...node, parentId: null });
  const coercedEdges = (Array.isArray(edges) ? edges : []).flatMap(item => {
    const edge = coerceArchitectureEdge(item);
    return edge && ids.has(edge.source) && ids.has(edge.target) ? [edge] : [];
  });
  return { nodes: normalized, edges: coercedEdges };
}

function coerceArchitectureNode(value: unknown): ArchitectureNode | null {
  const parsed = architectureNodeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string" || !raw.title.trim()) return null;
  const reference = raw.reference && typeof raw.reference === "object" ? raw.reference as Record<string, unknown> : null;
  const path = typeof reference?.path === "string" ? reference.path : "";
  const repositoryId = typeof reference?.repositoryId === "string" ? reference.repositoryId : undefined;
  const purpose = [raw.purpose, raw.description, raw.meta].filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("\n");
  const candidate = {
    id: raw.id.slice(0, 120),
    kind: raw.type === "group" || raw.kind === "boundary" ? "boundary" : "part",
    title: raw.title.trim().slice(0, 160),
    purpose: purpose.slice(0, 1200),
    x: typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : 0,
    y: typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : 0,
    parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    binding: path ? { ...(repositoryId ? { repositoryId } : {}), path } : null
  };
  const again = architectureNodeSchema.safeParse(candidate);
  return again.success ? again.data : null;
}

function coerceArchitectureEdge(value: unknown): ArchitectureEdge | null {
  const parsed = architectureEdgeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const source = typeof raw.source === "string" ? raw.source : typeof raw.from === "string" ? raw.from : "";
  const target = typeof raw.target === "string" ? raw.target : typeof raw.to === "string" ? raw.to : "";
  const kind = legacyEdgeKind[typeof raw.kind === "string" ? raw.kind : ""] ?? "depends";
  if (!source || !target) return null;
  const candidate = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 120) : `${source}->${target}`,
    source: source.slice(0, 120),
    target: target.slice(0, 120),
    sourceHandle: typeof raw.sourceHandle === "string" ? raw.sourceHandle : null,
    targetHandle: typeof raw.targetHandle === "string" ? raw.targetHandle : null,
    kind,
    label: typeof raw.label === "string" ? raw.label.slice(0, 120) : ""
  };
  const again = architectureEdgeSchema.safeParse(candidate);
  return again.success ? again.data : null;
}

