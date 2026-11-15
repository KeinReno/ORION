import { z } from "zod";

/**
 * Architect (задание 11.3): карта репозитория для 2D-редактора. Анализатор работает на уровне
 * файлов/импортов (regex/lexer), без AST-инструментов и новых тяжёлых зависимостей. Раскладка и
 * загруженная проектная схема — пользовательские данные пространства (jsonb), а не копия кода:
 * удаление записи раскладки не трогает сам репозиторий.
 */

export const architectNodeKindSchema = z.enum(["file", "dir", "crate", "module"]);
export type ArchitectNodeKind = z.infer<typeof architectNodeKindSchema>;

export const architectNodeSchema = z.object({
  /** Стабильный id — путь от корня репозитория (posix-разделители). */
  id: z.string(),
  name: z.string(),
  kind: architectNodeKindSchema,
  path: z.string(),
  parentId: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  /** Сколько файлов внутри (для dir/crate/module); у file — 1. */
  fileCount: z.number().int().nonnegative(),
  /** Суммарный размер файлов внутри, байты. */
  sizeBytes: z.number().int().nonnegative(),
  /** Позиция из сохранённой раскладки; `null`, если пользователь её ещё не задал. */
  x: z.number().nullable(),
  y: z.number().nullable()
});
export type ArchitectNode = z.infer<typeof architectNodeSchema>;

export const architectEdgeKindSchema = z.enum(["import", "call"]);
export type ArchitectEdgeKind = z.infer<typeof architectEdgeKindSchema>;

export const architectEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: architectEdgeKindSchema,
  /** Внешняя зависимость (npm/крейт) — узел не из репозитория, `to` начинается с `external:`. */
  external: z.boolean()
});
export type ArchitectEdge = z.infer<typeof architectEdgeSchema>;

export const architectMetricsSchema = z.object({
  files: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  modules: z.number().int().nonnegative(),
  crates: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  internalEdges: z.number().int().nonnegative(),
  externalEdges: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative()
});
export type ArchitectMetrics = z.infer<typeof architectMetricsSchema>;

export const architectMapQuerySchema = z.object({
  /** Подкаталог внутри репозитория; пусто — весь репозиторий. */
  path: z.string().trim().max(1024).optional(),
  /** Ревизия (sha, ветка, тег): карта строится по состоянию на этот коммит, а не по рабочей копии. */
  ref: z.string().trim().min(1).max(255).optional()
});
export type ArchitectMapQuery = z.infer<typeof architectMapQuerySchema>;

export const architectMapSchema = z.object({
  repository: z.object({ id: z.string(), name: z.string() }),
  /** Запрошенный подкаталог (`""` — корень). */
  path: z.string(),
  nodes: z.array(architectNodeSchema),
  edges: z.array(architectEdgeSchema),
  metrics: architectMetricsSchema,
  /** Ревизия сохранённой раскладки; `0` — раскладки ещё нет. */
  layoutRevision: z.number().int().nonnegative(),
  /** Анализ упёрся в потолок файлов: карта неполная. */
  truncated: z.boolean()
});
export type ArchitectMap = z.infer<typeof architectMapSchema>;

export const architectNodePositionSchema = z.object({
  id: z.string().min(1).max(2048),
  x: z.number(),
  y: z.number()
});
export type ArchitectNodePosition = z.infer<typeof architectNodePositionSchema>;

export const architectLayoutInputSchema = z.object({
  nodes: z.array(architectNodePositionSchema).max(20_000),
  viewport: z
    .object({ x: z.number(), y: z.number(), zoom: z.number().min(0.05).max(8) })
    .strict()
    .optional(),
  /** Если задано и не совпало с сохранённой ревизией — 412, раскладка не перезаписывается. */
  expectedRevision: z.number().int().nonnegative().optional()
});
export type ArchitectLayoutInput = z.infer<typeof architectLayoutInputSchema>;

export const architectLayoutSchema = z.object({
  repositoryId: z.string(),
  nodes: z.array(architectNodePositionSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().nullable()
});

/** Снапшот карты на ревизии: зафиксированный анализ, чтобы диффы по истории не пересчитывались. */
export const architectSnapshotSchema = z.object({
  repositoryId: z.string(),
  sha: z.string(),
  nodes: z.array(architectNodeSchema),
  edges: z.array(architectEdgeSchema),
  metrics: architectMetricsSchema,
  truncated: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.string().datetime()
});
export type ArchitectSnapshot = z.infer<typeof architectSnapshotSchema>;

/** Краткая строка списка снапшотов — без узлов и связей. */
export const architectSnapshotSummarySchema = architectSnapshotSchema.omit({ nodes: true, edges: true }).extend({
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative()
});
export type ArchitectSnapshotSummary = z.infer<typeof architectSnapshotSummarySchema>;

export const createArchitectSnapshotInputSchema = z.object({
  /** Ревизия (sha, ветка, тег); по умолчанию сервер берёт HEAD. */
  ref: z.string().trim().min(1).max(255).optional()
});
export type CreateArchitectSnapshotInput = z.infer<typeof createArchitectSnapshotInputSchema>;
export type ArchitectLayout = z.infer<typeof architectLayoutSchema>;

/** Проектная схема: то, как связи задуманы. id узлов — те же пути, что и в фактической карте. */
export const architectProjectSchemaSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(2048),
        name: z.string().min(1).max(512),
        kind: architectNodeKindSchema,
        path: z.string().max(2048)
      })
    )
    .max(20_000),
  edges: z
    .array(z.object({ from: z.string().min(1).max(2048), to: z.string().min(1).max(2048), kind: architectEdgeKindSchema }))
    .max(100_000)
});
export type ArchitectProjectSchema = z.infer<typeof architectProjectSchemaSchema>;

export const architectComparisonIssueKindSchema = z.enum(["missing_edge", "extra_edge", "missing_node", "extra_node"]);
export type ArchitectComparisonIssueKind = z.infer<typeof architectComparisonIssueKindSchema>;

export const architectComparisonIssueSchema = z.object({
  kind: architectComparisonIssueKindSchema,
  id: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  title: z.string()
});
export type ArchitectComparisonIssue = z.infer<typeof architectComparisonIssueSchema>;

export const architectComparisonSchema = z.object({
  repositoryId: z.string(),
  /** Сколько ребер/узлов в проектной схеме и сколько нашёл анализатор. */
  project: z.object({ nodes: z.number().int().nonnegative(), edges: z.number().int().nonnegative() }),
  actual: z.object({ nodes: z.number().int().nonnegative(), edges: z.number().int().nonnegative() }),
  /** `extra_*` — есть в проектной схеме, но не в коде (лишнее); `missing_*` — есть в коде, но не задумано. */
  issues: z.array(architectComparisonIssueSchema),
  counts: z.object({
    missingEdges: z.number().int().nonnegative(),
    extraEdges: z.number().int().nonnegative(),
    missingNodes: z.number().int().nonnegative(),
    extraNodes: z.number().int().nonnegative()
  })
});
export type ArchitectComparison = z.infer<typeof architectComparisonSchema>;

function edgeKey(edge: { from: string; to: string; kind: string }): string {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

/** Изменение узла, существующего в обеих ревизиях: размер файла изменился (переименование — это удаление + добавление). */
export const architectMapChangedNodeSchema = z.object({
  id: z.string(),
  fromSizeBytes: z.number().int().nonnegative(),
  toSizeBytes: z.number().int().nonnegative()
});
export type ArchitectMapChangedNode = z.infer<typeof architectMapChangedNodeSchema>;

/** Разница двух карт архитектуры: что появилось, исчезло и изменилось между базовой и целевой ревизией. */
export const architectMapDiffSchema = z.object({
  addedNodes: z.array(z.string()),
  removedNodes: z.array(z.string()),
  addedEdges: z.array(z.string()),
  removedEdges: z.array(z.string()),
  changedNodes: z.array(architectMapChangedNodeSchema)
});
export type ArchitectMapDiff = z.infer<typeof architectMapDiffSchema>;

/**
 * Диф двух карт (чистая функция). Ключ ребра — `kind:from->to`, чтобы переименования полей внутри
 * файла не выглядели как новая связь. Узлы сравниваются по id-пути; `changedNodes` — те же id,
 * но другой размер (правка содержимого без изменения структуры).
 */
export function diffArchitectMaps(
  base: { nodes: ReadonlyArray<{ id: string; sizeBytes: number }>; edges: ReadonlyArray<{ from: string; to: string; kind: string }> },
  target: { nodes: ReadonlyArray<{ id: string; sizeBytes: number }>; edges: ReadonlyArray<{ from: string; to: string; kind: string }> }
): ArchitectMapDiff {
  const baseNodes = new Map(base.nodes.map(node => [node.id, node.sizeBytes]));
  const targetNodes = new Map(target.nodes.map(node => [node.id, node.sizeBytes]));
  const edgeKeyOf = (edge: { from: string; to: string; kind: string }) => `${edge.kind}:${edge.from}->${edge.to}`;
  const baseEdges = new Set(base.edges.map(edgeKeyOf));
  const targetEdges = new Set(target.edges.map(edgeKeyOf));

  const addedNodes = [...targetNodes.keys()].filter(id => !baseNodes.has(id)).sort();
  const removedNodes = [...baseNodes.keys()].filter(id => !targetNodes.has(id)).sort();
  const changedNodes = [...targetNodes.entries()]
    .filter(([id, size]) => baseNodes.has(id) && baseNodes.get(id) !== size)
    .map(([id, size]) => ({ id, fromSizeBytes: baseNodes.get(id) as number, toSizeBytes: size }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    addedNodes,
    removedNodes,
    addedEdges: [...targetEdges].filter(key => !baseEdges.has(key)).sort(),
    removedEdges: [...baseEdges].filter(key => !targetEdges.has(key)).sort(),
    changedNodes
  };
}

/**
 * Расхождение «как задумано» ↔ «как в коде». Чистая функция: одинаковая на сервере и в тестах,
 * порядок результата детерминирован (сначала узлы, затем связи, внутри — по ключу), чтобы ответ
 * не зависел от порядка обхода файлов.
 *
 * `extra_edge` — связь объявлена проектной схемой, но анализатор её не нашёл (её вставили в схему
 * или код разошёлся с замыслом). `missing_edge` — связь есть в коде, но не описана.
 */
export function compareArchitectSchemas(
  repositoryId: string,
  project: ArchitectProjectSchema,
  actual: { nodes: ReadonlyArray<{ id: string; kind: string }>; edges: ReadonlyArray<{ from: string; to: string; kind: string }> }
): ArchitectComparison {
  const projectNodeIds = new Set(project.nodes.map((node) => node.id));
  const actualNodeIds = new Set(actual.nodes.map((node) => node.id));
  const projectEdges = new Map<string, { from: string; to: string; kind: string }>();
  for (const edge of project.edges) projectEdges.set(edgeKey(edge), edge);
  const actualEdges = new Map<string, { from: string; to: string; kind: string }>();
  for (const edge of actual.edges) actualEdges.set(edgeKey(edge), edge);

  const issues: ArchitectComparisonIssue[] = [];
  for (const id of [...projectNodeIds].filter((id) => !actualNodeIds.has(id)).sort()) {
    issues.push({ kind: "extra_node", id, from: null, to: null, title: `В проектной схеме есть узел, которого нет в коде: ${id}` });
  }
  for (const id of [...actualNodeIds].filter((id) => !projectNodeIds.has(id)).sort()) {
    issues.push({ kind: "missing_node", id, from: null, to: null, title: `В коде есть узел, не описанный проектной схемой: ${id}` });
  }
  for (const [key, edge] of [...projectEdges].filter(([key]) => !actualEdges.has(key)).sort(([a], [b]) => a.localeCompare(b))) {
    issues.push({ kind: "extra_edge", id: key, from: edge.from, to: edge.to, title: `Лишняя связь (объявлена, но не найдена в коде): ${edge.from} → ${edge.to}` });
  }
  for (const [key, edge] of [...actualEdges].filter(([key]) => !projectEdges.has(key)).sort(([a], [b]) => a.localeCompare(b))) {
    issues.push({ kind: "missing_edge", id: key, from: edge.from, to: edge.to, title: `Неописанная связь (есть в коде): ${edge.from} → ${edge.to}` });
  }
  return {
    repositoryId,
    project: { nodes: project.nodes.length, edges: project.edges.length },
    actual: { nodes: actual.nodes.length, edges: actual.edges.length },
    issues,
    counts: {
      missingEdges: issues.filter((issue) => issue.kind === "missing_edge").length,
      extraEdges: issues.filter((issue) => issue.kind === "extra_edge").length,
      missingNodes: issues.filter((issue) => issue.kind === "missing_node").length,
      extraNodes: issues.filter((issue) => issue.kind === "extra_node").length
    }
  };
}
