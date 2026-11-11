import { z } from "zod";

/**
 * Server-side constellation canvas (08-goals-constellations).
 *
 * The canvas is a PRESENTATION over existing Goal/Project/Task/Milestone rows:
 * it stores coordinates, zones and a viewport, never a copy of an entity. All
 * pure decisions (per-entry merge, deterministic auto-layout) live here so the
 * API and any future client compute the same result from the same input.
 */
export const goalCanvasEntityTypeSchema = z.enum(["goal", "project", "task", "milestone", "material"]);
export type GoalCanvasEntityType = z.infer<typeof goalCanvasEntityTypeSchema>;

/** Stable canvas key: entity ids are only unique inside their table. */
export function goalCanvasKey(entityType: GoalCanvasEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/**
 * One node on the canvas. `updatedAt` is the per-entry last-write stamp used by
 * the merge; `dirty` marks a node a person moved by hand (an anchor the
 * auto-layout must not move); `broken` is calculated on read and never stored.
 */
export const goalCanvasEntrySchema = z.object({
  entityType: goalCanvasEntityTypeSchema,
  entityId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(10_000).optional(),
  collapsed: z.boolean().optional(),
  dirty: z.boolean().optional(),
  updatedAt: z.string().datetime(),
  broken: z.boolean().optional()
});
export type GoalCanvasEntry = z.infer<typeof goalCanvasEntrySchema>;

export const goalCanvasEntriesSchema = z.array(goalCanvasEntrySchema).max(5000);

export const goalCanvasViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().min(0.01).max(8)
});
export type GoalCanvasViewport = z.infer<typeof goalCanvasViewportSchema>;

export const DEFAULT_GOAL_CANVAS_VIEWPORT: GoalCanvasViewport = { x: 0, y: 0, zoom: 1 };

/**
 * A visual zone groups nodes. Order of both zones and `entityIds` is kept as
 * sent (the sky paints them in this order); a zone never owns an entity.
 * `entityIds` are plain entity ids; the matching canvas entry supplies the type.
 */
export const goalCanvasZoneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().max(40).optional(),
  entityIds: z.array(z.string().min(1)).max(1000)
});
export type GoalCanvasZone = z.infer<typeof goalCanvasZoneSchema>;

export const goalCanvasZonesSchema = z.array(goalCanvasZoneSchema).max(200);

export const goalCanvasLayoutSchema = z.object({
  goalId: z.string(),
  workspaceId: z.string(),
  entries: goalCanvasEntriesSchema,
  viewport: goalCanvasViewportSchema,
  zones: goalCanvasZonesSchema,
  /** Bumped on every accepted write; doubles as the ETag for a full replacement. */
  revision: z.number().int().nonnegative(),
  updatedAt: z.string()
});
export type GoalCanvasLayout = z.infer<typeof goalCanvasLayoutSchema>;

/** Input entry: `updatedAt` is optional and filled from the request time when omitted. */
export const goalCanvasEntryInputSchema = goalCanvasEntrySchema
  .omit({ broken: true })
  .extend({ updatedAt: z.string().datetime().optional() });
export type GoalCanvasEntryInput = z.infer<typeof goalCanvasEntryInputSchema>;

/**
 * PUT body. Without `replace` the entries are merged per node by `updatedAt`
 * (the newer write wins; an equal/older stamp on the same node becomes a
 * conflict instead of silently overwriting). `replace: true` is a full
 * replacement and requires an `If-Match` header with the current revision.
 */
export const putGoalCanvasLayoutInputSchema = z.object({
  entries: z.array(goalCanvasEntryInputSchema).max(5000).optional(),
  viewport: goalCanvasViewportSchema.optional(),
  zones: goalCanvasZonesSchema.optional(),
  replace: z.boolean().default(false)
});
export type PutGoalCanvasLayoutInput = z.infer<typeof putGoalCanvasLayoutInputSchema>;

export const goalCanvasConflictSchema = z.object({
  id: z.string(),
  entityType: goalCanvasEntityTypeSchema,
  entityId: z.string(),
  /** `stale` — the stored version is newer; `ambiguous` — same stamp, different coordinates. */
  reason: z.enum(["stale", "ambiguous"]),
  /** The version the client sent — kept so the person can choose it. */
  client: goalCanvasEntrySchema,
  /** The version currently stored. */
  server: goalCanvasEntrySchema,
  at: z.string()
});
export type GoalCanvasConflict = z.infer<typeof goalCanvasConflictSchema>;

export const goalCanvasConflictsSchema = z.array(goalCanvasConflictSchema).max(200);

export const goalCanvasLayoutResponseSchema = z.object({
  layout: goalCanvasLayoutSchema,
  /** Unresolved conflicts still kept on the server (both versions included). */
  conflicts: goalCanvasConflictsSchema
});
export type GoalCanvasLayoutResponse = z.infer<typeof goalCanvasLayoutResponseSchema>;

export const goalCanvasAutoInputSchema = z.object({
  /** Manual anchors stay where the person put them. */
  respectManual: z.boolean().default(true),
  /** Strategy seam: a later Rust optimizer (metaheuRUSTics) is a second value. */
  strategy: z.enum(["deterministic"]).default("deterministic")
});
export type GoalCanvasAutoInput = z.infer<typeof goalCanvasAutoInputSchema>;

export const goalCanvasAutoResultSchema = z.object({
  goalId: z.string(),
  strategy: z.enum(["deterministic"]),
  entries: goalCanvasEntriesSchema,
  viewport: goalCanvasViewportSchema,
  zones: goalCanvasZonesSchema
});
export type GoalCanvasAutoResult = z.infer<typeof goalCanvasAutoResultSchema>;

export const goalCanvasRefSchema = z.object({
  entityType: goalCanvasEntityTypeSchema,
  entityId: z.string()
});
export type GoalCanvasRef = z.infer<typeof goalCanvasRefSchema>;

export const goalGraphNodeSchema = z.object({
  entityType: goalCanvasEntityTypeSchema,
  entityId: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  status: z.string().nullable(),
  progress: z.number().min(0).max(100).nullable(),
  /** Structural parent (goal tree / project / milestone), not a link edge. */
  parent: goalCanvasRefSchema.nullable(),
  /** A stored layout node whose entity can no longer be resolved on this canvas. */
  broken: z.boolean(),
  x: z.number().nullable(),
  y: z.number().nullable()
});
export type GoalGraphNode = z.infer<typeof goalGraphNodeSchema>;

/**
 * Explicit node relations normalized to the three graph kinds. `depends_on`
 * is always exposed as prerequisite -> dependent (both legacy stored
 * directions — `depends_on` and `goal_prerequisite` — are normalized to it).
 */
export const goalGraphEdgeKindSchema = z.enum(["depends_on", "continues", "relates_to"]);
export type GoalGraphEdgeKind = z.infer<typeof goalGraphEdgeKindSchema>;

export const goalGraphEdgeSchema = z.object({
  linkId: z.string(),
  kind: goalGraphEdgeKindSchema,
  source: goalCanvasRefSchema,
  target: goalCanvasRefSchema
});
export type GoalGraphEdge = z.infer<typeof goalGraphEdgeSchema>;

export const goalGraphSchema = z.object({
  rootId: z.string(),
  nodes: z.array(goalGraphNodeSchema),
  edges: z.array(goalGraphEdgeSchema)
});
export type GoalGraph = z.infer<typeof goalGraphSchema>;

export const goalGraphSearchResultSchema = z.object({
  query: z.string(),
  nodes: z.array(goalGraphNodeSchema)
});
export type GoalGraphSearchResult = z.infer<typeof goalGraphSearchResultSchema>;

export const goalProgressStageSchema = z.object({
  planId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  weight: z.number().int(),
  progress: z.number().min(0).max(100).nullable(),
  tasks: z.number().int(),
  closed: z.number().int()
});
export type GoalProgressStage = z.infer<typeof goalProgressStageSchema>;

export const goalProgressProjectSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  weight: z.number().int(),
  progress: z.number().min(0).max(100).nullable(),
  tasks: z.number().int(),
  closed: z.number().int()
});
export type GoalProgressProject = z.infer<typeof goalProgressProjectSchema>;

export const goalProgressSubGoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  subWeight: z.number().int(),
  progress: z.number().min(0).max(100).nullable()
});
export type GoalProgressSubGoal = z.infer<typeof goalProgressSubGoalSchema>;

/**
 * Progress breakdown for one goal. `progress` is the SAME number as the goal
 * DTO (the plan-weighted mean over known stages, with sub-goals mixed in), so
 * the report can never disagree with the list. Stages are GoalPlan rows; a
 * stage's project contributes its canonical project progress; tasks contribute
 * equally inside their project (`weights` documents that hierarchy).
 */
export const goalProgressReportSchema = z.object({
  goalId: z.string(),
  progress: z.number().min(0).max(100).nullable(),
  unknownPlans: z.number().int(),
  unknownSubGoals: z.number().int(),
  weights: z.object({
    stage: z.literal("plan.weight"),
    project: z.literal("plan.weight"),
    task: z.literal("equal-share")
  }),
  stages: z.array(goalProgressStageSchema),
  projects: z.array(goalProgressProjectSchema),
  tasks: z.object({ total: z.number().int(), closed: z.number().int(), open: z.number().int() }),
  subGoals: z.array(goalProgressSubGoalSchema)
});
export type GoalProgressReport = z.infer<typeof goalProgressReportSchema>;

/** A node the deterministic auto-layout needs; only ordering facts, no titles required. */
export interface GoalCanvasLayoutNode {
  entityType: GoalCanvasEntityType;
  entityId: string;
  title: string;
  /** Creation-time tie-break inside a layer (null = unknown, sorted last). */
  createdAt?: string | null;
  /** Order inside the owning entity (task board order / milestone plan order). */
  order?: number;
}

/** Directed dependency edge: `source` must be finished before `target`. Keys are `goalCanvasKey()` values. */
export interface GoalCanvasDependencyEdge {
  source: string;
  target: string;
}

export interface GoalCanvasAutoOptions {
  /** Required so the function itself is deterministic; the server passes its request time. */
  nowIso: string;
  respectManual?: boolean;
  /** Current entries: entries with `dirty: true` are anchors when `respectManual` is on. */
  manual?: readonly GoalCanvasEntry[];
  /** Future strategy seam; today only the deterministic layout exists. */
  strategy?: "deterministic";
}

const TYPE_RANK: Record<GoalCanvasEntityType, number> = {
  goal: 0,
  project: 1,
  milestone: 2,
  task: 3,
  material: 4
};

const ROW_GAP = 148;
const COLUMN_GAP = 230;
const TOP = 120;
const MIN_DX = COLUMN_GAP * 0.7;
const MIN_DY = 100;
const FIT_WIDTH = 1200;
const FIT_HEIGHT = 800;
const FIT_PADDING = 240;

function nodeKey(node: { entityType: GoalCanvasEntityType; entityId: string }): string {
  return goalCanvasKey(node.entityType, node.entityId);
}

function compareNodes(a: GoalCanvasLayoutNode, b: GoalCanvasLayoutNode): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA < orderB ? -1 : 1;
  const byCreated = (a.createdAt ?? "~").localeCompare(b.createdAt ?? "~");
  if (byCreated !== 0) return byCreated;
  const byType = TYPE_RANK[a.entityType] - TYPE_RANK[b.entityType];
  if (byType !== 0) return byType;
  const byTitle = a.title.localeCompare(b.title, "ru");
  if (byTitle !== 0) return byTitle;
  return nodeKey(a).localeCompare(nodeKey(b));
}

/** Longest-path layering over a directed graph. Cycles are cut defensively (the link API owns rejection). */
export function goalCanvasDependencyLayers(
  nodes: ReadonlyArray<GoalCanvasLayoutNode>,
  edges: ReadonlyArray<GoalCanvasDependencyEdge>
): Map<string, number> {
  const byKey = new Map(nodes.map((node) => [nodeKey(node), node]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const key of byKey.keys()) indegree.set(key, 0);
  for (const edge of edges) {
    if (!byKey.has(edge.source) || !byKey.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const layer = new Map<string, number>();
  const ready = [...byKey.keys()].filter((key) => (indegree.get(key) ?? 0) === 0);
  const sortKeys = (keys: string[]): string[] =>
    keys.sort((a, b) => compareNodes(byKey.get(a)!, byKey.get(b)!));
  sortKeys(ready);
  const processed = new Set<string>();
  while (ready.length > 0) {
    const key = ready.shift()!;
    processed.add(key);
    if (!layer.has(key)) layer.set(key, 0);
    const targets = sortKeys([...(outgoing.get(key) ?? [])]);
    for (const target of targets) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(key) ?? 0) + 1));
      const next = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(target);
        sortKeys(ready);
      }
    }
  }
  // Whatever remains belongs to a cycle. Keep every node, layering it after the
  // part that was resolved, in deterministic order (no node is ever dropped).
  const remaining = sortKeys([...byKey.keys()].filter((key) => !processed.has(key)));
  const maxResolved = Math.max(-1, ...[...processed].map((key) => layer.get(key) ?? 0));
  remaining.forEach((key, index) => layer.set(key, maxResolved + 1 + index));
  return layer;
}

/** Number of leaves below a node (leaf = no outgoing dependency edges). Cycle-safe. */
function goalCanvasLeafCounts(
  nodes: ReadonlyArray<GoalCanvasLayoutNode>,
  edges: ReadonlyArray<GoalCanvasDependencyEdge>
): Map<string, number> {
  const keys = new Set(nodes.map(nodeKey));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!keys.has(edge.source) || !keys.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const leaves = (key: string): number => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 1;
    visiting.add(key);
    const targets = outgoing.get(key) ?? [];
    const value = targets.length === 0 ? 1 : targets.reduce((sum, target) => sum + leaves(target), 0);
    visiting.delete(key);
    memo.set(key, value);
    return value;
  };
  for (const key of keys) leaves(key);
  return memo;
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < MIN_DX && Math.abs(a.y - b.y) < MIN_DY;
}

/**
 * Deterministic layered layout: `depends_on` edges decide the row (a source is
 * always above its target), leaves decide the horizontal share inside a row.
 * Manual anchors never move when `respectManual` is on; generated nodes are
 * shifted right in whole columns until they overlap neither an anchor nor each
 * other. The same input always produces byte-identical coordinates.
 */
export function autoLayoutGoalCanvas(
  nodes: ReadonlyArray<GoalCanvasLayoutNode>,
  edges: ReadonlyArray<GoalCanvasDependencyEdge>,
  options: GoalCanvasAutoOptions
): { entries: GoalCanvasEntry[]; viewport: GoalCanvasViewport } {
  const byKey = new Map(nodes.map((node) => [nodeKey(node), node]));
  const layer = goalCanvasDependencyLayers(nodes, edges);
  const leafCount = goalCanvasLeafCounts(nodes, edges);
  const respectManual = options.respectManual ?? true;
  const manualByKey = new Map<string, GoalCanvasEntry>();
  if (respectManual) {
    for (const entry of options.manual ?? []) manualByKey.set(nodeKey(entry), entry);
  }
  const placed: Array<{ x: number; y: number }> = [];
  const entries: GoalCanvasEntry[] = [];

  const orderedKeys = [...byKey.keys()].sort((a, b) => compareNodes(byKey.get(a)!, byKey.get(b)!));
  for (const key of orderedKeys) {
    const entry = manualByKey.get(key);
    if (!entry) continue;
    const node = byKey.get(key)!;
    const anchored: GoalCanvasEntry = {
      ...entry,
      entityType: node.entityType,
      entityId: node.entityId,
      dirty: entry.dirty ?? true
    };
    entries.push(anchored);
    placed.push({ x: anchored.x, y: anchored.y });
  }

  const layers = new Map<number, string[]>();
  for (const key of orderedKeys) {
    if (manualByKey.has(key)) continue;
    const value = layer.get(key) ?? 0;
    layers.set(value, [...(layers.get(value) ?? []), key]);
  }
  for (const value of [...layers.keys()].sort((a, b) => a - b)) {
    const keys = (layers.get(value) ?? []).sort((a, b) => compareNodes(byKey.get(a)!, byKey.get(b)!));
    const weights = keys.map((key) => Math.max(1, leafCount.get(key) ?? 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = -total / 2;
    keys.forEach((key, index) => {
      const weight = weights[index]!;
      const node = byKey.get(key)!;
      let x = (cursor + weight / 2) * COLUMN_GAP;
      const y = TOP + value * ROW_GAP;
      let guard = 0;
      while (placed.some((other) => overlaps({ x, y }, other)) && guard < 200) {
        x += COLUMN_GAP;
        guard += 1;
      }
      cursor += weight;
      placed.push({ x, y });
      entries.push({
        entityType: node.entityType,
        entityId: node.entityId,
        x: Math.round(x * 1000) / 1000,
        y,
        dirty: false,
        updatedAt: options.nowIso
      });
    });
  }

  // Keep layout nodes that are not part of this graph (pinned foreign records,
  // broken references): auto-layout must never silently delete them.
  for (const entry of options.manual ?? []) {
    if (byKey.has(nodeKey(entry))) continue;
    const already = entries.some((item) => nodeKey(item) === nodeKey(entry));
    if (!already) entries.push({ ...entry, dirty: entry.dirty ?? true });
  }
  entries.sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));

  const xs = entries.map((entry) => entry.x);
  const ys = entries.map((entry) => entry.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const spanX = maxX - minX + FIT_PADDING;
  const spanY = maxY - minY + FIT_PADDING;
  const zoom = Math.max(0.05, Math.min(1, Math.min(FIT_WIDTH / spanX, FIT_HEIGHT / spanY)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    entries,
    viewport: {
      x: round(FIT_WIDTH / 2 - centerX * zoom),
      y: round(FIT_HEIGHT / 2 - centerY * zoom),
      zoom: round(zoom)
    }
  };
}

export interface GoalCanvasConflictDraft {
  entityType: GoalCanvasEntityType;
  entityId: string;
  reason: "stale" | "ambiguous";
  client: GoalCanvasEntry;
  server: GoalCanvasEntry;
}

export interface GoalCanvasMergeResult {
  entries: GoalCanvasEntry[];
  conflicts: GoalCanvasConflictDraft[];
  /** Keys the client's version won or introduced — stored conflicts for them are resolved. */
  accepted: string[];
  changed: boolean;
}

function samePosition(a: GoalCanvasEntry, b: GoalCanvasEntry): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && (a.collapsed ?? false) === (b.collapsed ?? false);
}

/**
 * Per-node last-write-wins merge for a partial PUT. A newer client stamp
 * replaces the stored node; an older or equal stamp never overwrites a newer
 * stored one — it yields a conflict carrying BOTH versions, so no version is
 * lost. Entries not mentioned by the client are untouched.
 */
export function mergeGoalCanvasEntries(
  current: ReadonlyArray<GoalCanvasEntry>,
  incoming: ReadonlyArray<GoalCanvasEntryInput>,
  nowIso: string
): GoalCanvasMergeResult {
  const entries = current.map((entry) => ({ ...entry }));
  const byKey = new Map(entries.map((entry, index) => [nodeKey(entry), index]));
  const conflicts: GoalCanvasConflictDraft[] = [];
  const accepted: string[] = [];
  let changed = false;

  for (const raw of incoming) {
    const client: GoalCanvasEntry = { ...(raw as GoalCanvasEntry), updatedAt: raw.updatedAt ?? nowIso };
    delete client.broken;
    const key = nodeKey(client);
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, entries.length);
      entries.push(client);
      accepted.push(key);
      changed = true;
      continue;
    }
    const server = entries[index]!;
    const clientTime = Date.parse(client.updatedAt);
    const serverTime = Date.parse(server.updatedAt);
    if (clientTime > serverTime) {
      entries[index] = { ...client };
      accepted.push(key);
      changed = true;
    } else if (clientTime === serverTime) {
      if (!samePosition(client, server)) {
        conflicts.push({ entityType: client.entityType, entityId: client.entityId, reason: "ambiguous", client, server });
      }
    } else if (!samePosition(client, server)) {
      conflicts.push({ entityType: client.entityType, entityId: client.entityId, reason: "stale", client, server });
    }
  }

  return { entries, conflicts, accepted, changed };
}
