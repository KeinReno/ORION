import { BadRequestException, HttpException, Injectable, NotFoundException, PreconditionFailedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EntityLinkKind, GoalCanvasLayout as LayoutRow, Prisma } from "@prisma/client";
import {
  DEFAULT_GOAL_CANVAS_VIEWPORT,
  autoLayoutGoalCanvas,
  goalCanvasConflictsSchema,
  goalCanvasEntriesSchema,
  goalCanvasKey,
  goalCanvasViewportSchema,
  goalCanvasZonesSchema,
  isTaskClosed,
  mergeGoalCanvasEntries,
  milestoneStatusSchema,
  taskStatusSchema,
  type Goal,
  type GoalCanvasAutoInput,
  type GoalCanvasAutoResult,
  type GoalCanvasConflict,
  type GoalCanvasConflictDraft,
  type GoalCanvasDependencyEdge,
  type GoalCanvasEntry,
  type GoalCanvasLayout,
  type GoalCanvasLayoutNode,
  type GoalCanvasLayoutResponse,
  type GoalCanvasRef,
  type GoalGraph,
  type GoalGraphEdge,
  type GoalGraphEdgeKind,
  type GoalGraphNode,
  type GoalGraphSearchResult,
  type GoalProgressReport,
  type PutGoalCanvasLayoutInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { GoalTaskReader } from "../tasks/public/goal-task-reader";
import { GoalsService } from "./goals.service";

interface CanvasModel {
  root: Goal;
  layout: LayoutRow | null;
  nodes: Map<string, GoalGraphNode>;
  layoutNodes: GoalCanvasLayoutNode[];
  edges: GoalGraphEdge[];
  /** Semantic prerequisite -> dependent edges for the auto-layout. */
  dependencies: GoalCanvasDependencyEdge[];
}

const ENTRIES = goalCanvasEntriesSchema.catch([]);
const ZONES = goalCanvasZonesSchema.catch([]);
const VIEWPORT = goalCanvasViewportSchema.catch(DEFAULT_GOAL_CANVAS_VIEWPORT);
const CONFLICTS = goalCanvasConflictsSchema.catch([]);

const GRAPH_KIND: Record<string, GoalGraphEdgeKind | undefined> = {
  depends_on: "depends_on",
  // Legacy goal dependency (goal -> goal). Both legacy kinds are normalized to
  // `depends_on` in the semantic prerequisite -> dependent direction below.
  goal_prerequisite: "depends_on",
  continues: "continues",
  relates_to: "relates_to",
  related_to: "relates_to"
};

function refKey(ref: GoalCanvasRef): string {
  return goalCanvasKey(ref.entityType, ref.entityId);
}

/** ETag is the layout revision: `"7"` (weak prefix tolerated). */
function parseIfMatch(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return /^\d+$/.test(clean) ? Number(clean) : null;
}

/**
 * 08 — constellation canvas (layout, graph, auto-layout, progress, search).
 *
 * The layout is server-side presentation state over existing entities. The
 * graph is assembled from the goal's own subtree and the public owner
 * projections (`GoalsService`, `GoalTaskReader`): this module never reads
 * Task/Project/Milestone tables itself. The only core table read here is
 * `entity_links` — a read-only projection of the core link layer; every write
 * still goes through EntityLinksService.
 */
@Injectable()
export class GoalCanvasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly goals: GoalsService,
    private readonly tasks: GoalTaskReader
  ) {}

  async getLayout(userId: string, workspaceId: string, goalId: string): Promise<GoalCanvasLayoutResponse> {
    const model = await this.collect(userId, workspaceId, goalId);
    const entries = ENTRIES.parse(model.layout?.entries ?? []).map((entry) => ({
      ...entry,
      ...(entry.entityType === "material" ? {} : { broken: model.nodes.get(goalCanvasKey(entry.entityType, entry.entityId))?.broken === true })
    }));
    return {
      layout: this.toLayoutDto(model.layout, workspaceId, goalId, entries),
      conflicts: CONFLICTS.parse(model.layout?.conflicts ?? [])
    };
  }

  async putLayout(
    userId: string,
    workspaceId: string,
    goalId: string,
    input: PutGoalCanvasLayoutInput,
    ifMatch: string | undefined
  ): Promise<GoalCanvasLayoutResponse> {
    const now = new Date().toISOString();
    const result = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const goal = await tx.goal.findFirst({ where: { id: goalId, workspaceId }, select: { id: true } });
      if (!goal) throw new NotFoundException("Цель не найдена");
      // Serialize layout writes for this goal: two clients editing different
      // nodes must both survive, and a full replacement must see a stable ETag.
      await tx.$queryRaw`SELECT "id" FROM "goals" WHERE "id" = ${goalId} FOR UPDATE`;
      const row = await tx.goalCanvasLayout.findUnique({ where: { goalId } });
      if (row && row.workspaceId !== workspaceId) throw new NotFoundException("Раскладка не найдена");

      const currentEntries = ENTRIES.parse(row?.entries ?? []);
      const storedConflicts = CONFLICTS.parse(row?.conflicts ?? []);
      let entries = currentEntries;
      let conflicts = storedConflicts;

      if (input.replace) {
        if (input.entries === undefined) throw new BadRequestException("Для полной замены нужен массив entries");
        const revision = row?.revision ?? 0;
        const expected = parseIfMatch(ifMatch);
        if (expected === null) {
          throw new HttpException("Для полной замены нужен заголовок If-Match с текущей ревизией", 428);
        }
        if (expected !== revision) throw new PreconditionFailedException("Раскладка уже изменена другим клиентом");
        entries = input.entries.map((entry) => {
          const full: GoalCanvasEntry = { ...(entry as GoalCanvasEntry), updatedAt: entry.updatedAt ?? now };
          delete full.broken;
          return full;
        });
        conflicts = [];
      } else if (input.entries !== undefined) {
        const merged = mergeGoalCanvasEntries(currentEntries, input.entries, now);
        entries = merged.entries;
        const resolving = new Set([...merged.accepted, ...merged.conflicts.map((item) => goalCanvasKey(item.entityType, item.entityId))]);
        const kept = storedConflicts.filter((item) => !resolving.has(goalCanvasKey(item.entityType, item.entityId)));
        const added: GoalCanvasConflict[] = merged.conflicts.map((item: GoalCanvasConflictDraft) => ({
          id: randomUUID(),
          ...item,
          at: now
        }));
        conflicts = [...kept, ...added].slice(-200);
      }

      const viewport = input.viewport ?? VIEWPORT.parse(row?.viewport ?? DEFAULT_GOAL_CANVAS_VIEWPORT);
      const zones = input.zones ?? ZONES.parse(row?.zones ?? []);
      const revision = (row?.revision ?? 0) + 1;
      const saved = await tx.goalCanvasLayout.upsert({
        where: { goalId },
        create: {
          workspaceId,
          goalId,
          entries: entries as unknown as Prisma.InputJsonValue,
          viewport: viewport as unknown as Prisma.InputJsonValue,
          zones: zones as unknown as Prisma.InputJsonValue,
          conflicts: conflicts as unknown as Prisma.InputJsonValue,
          revision
        },
        update: {
          entries: entries as unknown as Prisma.InputJsonValue,
          viewport: viewport as unknown as Prisma.InputJsonValue,
          zones: zones as unknown as Prisma.InputJsonValue,
          conflicts: conflicts as unknown as Prisma.InputJsonValue,
          revision
        }
      });
      return saved;
    });
    return {
      layout: this.toLayoutDto(result, workspaceId, goalId, ENTRIES.parse(result.entries)),
      conflicts: CONFLICTS.parse(result.conflicts)
    };
  }

  async autoLayout(userId: string, workspaceId: string, goalId: string, input: GoalCanvasAutoInput): Promise<GoalCanvasAutoResult> {
    const model = await this.collect(userId, workspaceId, goalId);
    const manual = ENTRIES.parse(model.layout?.entries ?? []);
    const result = autoLayoutGoalCanvas(model.layoutNodes, model.dependencies, {
      nowIso: new Date().toISOString(),
      respectManual: input.respectManual,
      manual,
      strategy: input.strategy
    });
    return {
      goalId,
      strategy: input.strategy,
      entries: result.entries,
      viewport: result.viewport,
      zones: ZONES.parse(model.layout?.zones ?? [])
    };
  }

  async graph(userId: string, workspaceId: string, goalId: string): Promise<GoalGraph> {
    const model = await this.collect(userId, workspaceId, goalId);
    return {
      rootId: model.root.id,
      nodes: [...model.nodes.values()].sort(compareGraphNodes),
      edges: [...model.edges].sort((a, b) => a.linkId.localeCompare(b.linkId))
    };
  }

  async progress(userId: string, workspaceId: string, goalId: string): Promise<GoalProgressReport> {
    const all = await this.goals.list(userId, workspaceId);
    const goal = all.find((item) => item.id === goalId);
    if (!goal) throw new NotFoundException("Цель не найдена");
    const projects = new Map<string, { projectId: string; projectName: string; weight: number; progress: number | null; tasks: number; closed: number }>();
    for (const plan of goal.plans) {
      if (!projects.has(plan.projectId)) {
        projects.set(plan.projectId, {
          projectId: plan.projectId,
          projectName: plan.projectName,
          weight: plan.weight,
          progress: plan.progress,
          tasks: plan.tasks,
          closed: plan.closed
        });
      }
    }
    const stages = goal.plans.map((plan) => ({
      planId: plan.id,
      projectId: plan.projectId,
      projectName: plan.projectName,
      weight: plan.weight,
      progress: plan.progress,
      tasks: plan.tasks,
      closed: plan.closed
    }));
    const totals = [...projects.values()].reduce(
      (sum, project) => ({ total: sum.total + project.tasks, closed: sum.closed + project.closed }),
      { total: 0, closed: 0 }
    );
    return {
      goalId: goal.id,
      progress: goal.progress,
      unknownPlans: goal.unknownPlans,
      unknownSubGoals: goal.unknownSubGoals,
      weights: { stage: "plan.weight", project: "plan.weight", task: "equal-share" },
      stages,
      projects: [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, "ru")),
      tasks: { total: totals.total, closed: totals.closed, open: totals.total - totals.closed },
      subGoals: all
        .filter((item) => item.parentId === goal.id)
        .map((item) => ({ id: item.id, title: item.title, subWeight: item.subWeight, progress: item.progress }))
    };
  }

  async search(userId: string, workspaceId: string, goalId: string, query: string): Promise<GoalGraphSearchResult> {
    const graph = await this.graph(userId, workspaceId, goalId);
    const term = query.trim().toLocaleLowerCase("ru");
    if (!term) return { query, nodes: [] };
    return {
      query,
      nodes: graph.nodes
        .filter((node) => !node.broken && node.title.toLocaleLowerCase("ru").includes(term))
        .slice(0, 50)
    };
  }

  private toLayoutDto(row: LayoutRow | null, workspaceId: string, goalId: string, entries: GoalCanvasEntry[]): GoalCanvasLayout {
    return {
      goalId,
      workspaceId,
      entries,
      viewport: VIEWPORT.parse(row?.viewport ?? DEFAULT_GOAL_CANVAS_VIEWPORT),
      zones: ZONES.parse(row?.zones ?? []),
      revision: row?.revision ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString()
    };
  }

  /**
   * Assembles the canvas projection for one goal. Public owner contracts supply
   * goal progress (GoalsService), tasks (GoalTaskReader) and milestones (they
   * already travel inside the Goal DTO plans); the core link table is only read.
   */
  private async collect(userId: string, workspaceId: string, goalId: string): Promise<CanvasModel> {
    const allGoals = await this.goals.list(userId, workspaceId);
    const root = allGoals.find((goal) => goal.id === goalId);
    if (!root) throw new NotFoundException("Цель не найдена");
    const byParent = new Map<string, Goal[]>();
    for (const goal of allGoals) {
      if (goal.parentId) byParent.set(goal.parentId, [...(byParent.get(goal.parentId) ?? []), goal]);
    }
    const subtree: Goal[] = [];
    const seen = new Set<string>();
    const stack = [root];
    while (stack.length > 0) {
      const goal = stack.pop()!;
      if (seen.has(goal.id)) continue;
      seen.add(goal.id);
      subtree.push(goal);
      for (const child of byParent.get(goal.id) ?? []) stack.push(child);
    }
    const projectIds = [...new Set(subtree.flatMap((goal) => goal.plans.map((plan) => plan.projectId)))];

    const extra = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const tasks = projectIds.length > 0 ? await this.tasks.plansTx(tx, workspaceId, projectIds) : [];
      // Read-only projection of the core link table (writes belong to EntityLinksService).
      const links = await tx.entityLink.findMany({
        where: { workspaceId, kind: { in: Object.keys(GRAPH_KIND) as EntityLinkKind[] } },
        select: { id: true, sourceType: true, sourceId: true, targetType: true, targetId: true, kind: true }
      });
      const layout = await tx.goalCanvasLayout.findUnique({ where: { goalId } });
      return { tasks, links, layout };
    });

    const nodes = new Map<string, GoalGraphNode>();
    const layoutNodes: GoalCanvasLayoutNode[] = [];
    const projectNames = new Map<string, string>();
    const milestoneKeys = new Set<string>();
    const addNode = (node: GoalGraphNode, order: number, createdAt: string | null = null): void => {
      const key = goalCanvasKey(node.entityType, node.entityId);
      if (nodes.has(key)) return;
      nodes.set(key, node);
      layoutNodes.push({ entityType: node.entityType, entityId: node.entityId, title: node.title, createdAt, order });
    };

    subtree.forEach((goal, index) => {
      addNode(
        {
          entityType: "goal",
          entityId: goal.id,
          title: goal.title,
          subtitle: "Цель",
          status: goal.status,
          progress: goal.progress,
          parent: goal.parentId && seen.has(goal.parentId) ? { entityType: "goal", entityId: goal.parentId } : null,
          broken: false,
          x: null,
          y: null
        },
        index,
        goal.createdAt
      );
    });

    for (const goal of subtree) {
      goal.plans.forEach((plan, planIndex) => {
        projectNames.set(plan.projectId, plan.projectName);
        addNode(
          {
            entityType: "project",
            entityId: plan.projectId,
            title: plan.projectName,
            subtitle: "Проект",
            status: null,
            progress: plan.progress,
            parent: { entityType: "goal", entityId: goal.id },
            broken: false,
            x: null,
            y: null
          },
          planIndex
        );
        plan.milestones.forEach((milestone, milestoneIndex) => {
          const key = goalCanvasKey("milestone", milestone.id);
          if (milestoneKeys.has(key)) return;
          milestoneKeys.add(key);
          addNode(
            {
              entityType: "milestone",
              entityId: milestone.id,
              title: milestone.title,
              subtitle: "Веха",
              status: milestoneStatusSchema.catch("planned").parse(milestone.status),
              progress: milestone.tasks === 0 ? null : Math.round((milestone.closed / milestone.tasks) * 100),
              parent: { entityType: "project", entityId: plan.projectId },
              broken: false,
              x: null,
              y: null
            },
            milestoneIndex
          );
        });
      });
    }

    for (const task of extra.tasks) {
      if (!task.projectId) continue;
      const status = taskStatusSchema.catch("todo").parse(task.status);
      addNode(
        {
          entityType: "task",
          entityId: task.id,
          title: task.title,
          subtitle: projectNames.get(task.projectId) ?? "Задача",
          status,
          progress: isTaskClosed(status) ? 100 : 0,
          parent: task.milestoneId
            ? { entityType: "milestone", entityId: task.milestoneId }
            : { entityType: "project", entityId: task.projectId },
          broken: false,
          x: null,
          y: null
        },
        task.sortOrder
      );
    }

    const layoutEntries = ENTRIES.parse(extra.layout?.entries ?? []);
    const coords = new Map(layoutEntries.map((entry) => [goalCanvasKey(entry.entityType, entry.entityId), entry]));
    for (const [key, node] of nodes) {
      const entry = coords.get(key);
      if (!entry) continue;
      node.x = entry.x;
      node.y = entry.y;
    }
    // A stored node whose entity cannot be resolved on this canvas stays on the
    // canvas as a broken marker — the row is never deleted because an entity is gone.
    for (const entry of layoutEntries) {
      if (entry.entityType === "material") continue; // opaque pinned record: no entity registry on this canvas
      const key = goalCanvasKey(entry.entityType, entry.entityId);
      if (nodes.has(key)) continue;
      // A goal from another constellation still exists: keep it as a live node
      // (parent outside this canvas) instead of calling it broken.
      const otherGoal = entry.entityType === "goal" ? allGoals.find((goal) => goal.id === entry.entityId) : undefined;
      if (otherGoal) {
        nodes.set(key, {
          entityType: "goal",
          entityId: otherGoal.id,
          title: otherGoal.title,
          subtitle: "Цель",
          status: otherGoal.status,
          progress: otherGoal.progress,
          parent: null,
          broken: false,
          x: entry.x,
          y: entry.y
        });
        continue;
      }
      nodes.set(key, {
        entityType: entry.entityType,
        entityId: entry.entityId,
        title: "Недоступная запись",
        subtitle: null,
        status: null,
        progress: null,
        parent: null,
        broken: true,
        x: entry.x,
        y: entry.y
      });
    }

    const edges: GoalGraphEdge[] = [];
    const dependencies: GoalCanvasDependencyEdge[] = [];
    for (const link of extra.links) {
      const kind = GRAPH_KIND[link.kind];
      if (!kind) continue;
      const storedSource = { entityType: link.sourceType as GoalCanvasRef["entityType"], entityId: link.sourceId };
      const storedTarget = { entityType: link.targetType as GoalCanvasRef["entityType"], entityId: link.targetId };
      if (!nodes.has(refKey(storedSource)) || !nodes.has(refKey(storedTarget))) continue;
      // The graph exposes `depends_on` in ONE semantic direction —
      // prerequisite -> dependent — regardless of the stored row direction:
      // `depends_on` stores dependent -> prerequisite, `goal_prerequisite`
      // already stores "must finish before" as source -> target.
      const source = link.kind === "depends_on" ? storedTarget : storedSource;
      const target = link.kind === "depends_on" ? storedSource : storedTarget;
      edges.push({ linkId: link.id, kind, source, target });
      if (kind === "depends_on") dependencies.push({ source: refKey(source), target: refKey(target) });
    }

    return { root, layout: extra.layout, nodes, layoutNodes, edges, dependencies };
  }
}

const GRAPH_TYPE_RANK: Record<GoalGraphNode["entityType"], number> = {
  goal: 0,
  project: 1,
  milestone: 2,
  task: 3,
  material: 4
};

function compareGraphNodes(a: GoalGraphNode, b: GoalGraphNode): number {
  return (
    GRAPH_TYPE_RANK[a.entityType] - GRAPH_TYPE_RANK[b.entityType] ||
    a.title.localeCompare(b.title, "ru") ||
    a.entityId.localeCompare(b.entityId)
  );
}
