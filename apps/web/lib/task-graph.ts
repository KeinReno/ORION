import type { Task } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";

/**
 * Two different relations between tasks, never mixed (see WORKSPACE_PROGRAM, Э3):
 *  - hierarchy  — `Task.parentId`: a task is part of another one (tree);
 *  - dependency — `Task.dependencyIds`: a task cannot be finished before others (graph).
 * Pure functions, no React: the tree and graph views only draw what is computed here.
 */

export interface TreeNode {
  task: Task;
  depth: number;
  children: TreeNode[];
  /** Open prerequisites of this task (known to the view); empty = not blocked. */
  blockedBy: Task[];
  /** Direct subtasks counted BEFORE hiding closed ones, so progress stays true when closed work is hidden. */
  childTotal: number;
  childClosed: number;
  /** Last among its own siblings — the row's own connector stops here instead of continuing down. */
  isLast: boolean;
  /** One entry per ancestor level (index = depth): true when that ancestor has a later sibling, so a
   *  guide line must run through its column past this row. Root rows carry an empty array. */
  guides: boolean[];
  /** This task or any task in its subtree is currently blocked — the signal a collapsed branch needs,
   *  since the per-task "ждёт" badge is invisible once its row is hidden under a collapsed ancestor. */
  hasBlockedDescendant: boolean;
}

function compareTasks(a: Task, b: Task): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ru");
}

/** Open prerequisites per task id. A dependency on a task outside `tasks` is ignored (unknown ≠ blocking). */
export function openBlockers(tasks: Task[]): Map<string, Task[]> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result = new Map<string, Task[]>();
  for (const task of tasks) {
    if (isTaskClosed(task.status)) continue;
    const blockers = task.dependencyIds
      .map((id) => byId.get(id))
      .filter((dep): dep is Task => dep !== undefined && !isTaskClosed(dep.status));
    if (blockers.length > 0) result.set(task.id, blockers);
  }
  return result;
}

/**
 * The hierarchy as a forest. A task whose parent is not among `tasks` (another project,
 * hidden as closed) becomes a root, so nothing silently disappears. Closed tasks are
 * dropped unless `showClosed`; a closed parent with open children stays so the children keep their place.
 */
export function buildTaskTree(tasks: Task[], showClosed: boolean): TreeNode[] {
  const blockers = openBlockers(tasks);
  const childrenOf = new Map<string, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  const roots: Task[] = [];
  for (const task of tasks) {
    if (task.parentId && ids.has(task.parentId) && task.parentId !== task.id) {
      const list = childrenOf.get(task.parentId) ?? [];
      list.push(task);
      childrenOf.set(task.parentId, list);
    } else {
      roots.push(task);
    }
  }

  const visiting = new Set<string>();
  function build(task: Task, depth: number, guides: boolean[], isLast: boolean): TreeNode | null {
    if (visiting.has(task.id)) return null; // a parent cycle in bad data must not hang the view
    visiting.add(task.id);
    const sortedChildren = (childrenOf.get(task.id) ?? []).sort(compareTasks);
    const childGuides = [...guides, !isLast];
    const children = sortedChildren
      .map((child, index) => build(child, depth + 1, childGuides, index === sortedChildren.length - 1))
      .filter((node): node is TreeNode => node !== null);
    visiting.delete(task.id);
    if (!showClosed && isTaskClosed(task.status) && children.length === 0) return null;
    const direct = childrenOf.get(task.id) ?? [];
    const ownBlocked = (blockers.get(task.id) ?? []).length > 0;
    return {
      task,
      depth,
      children,
      blockedBy: blockers.get(task.id) ?? [],
      childTotal: direct.length,
      childClosed: direct.filter((child) => isTaskClosed(child.status)).length,
      isLast,
      guides,
      hasBlockedDescendant: ownBlocked || children.some((child) => child.hasBlockedDescendant)
    };
  }

  return roots
    .sort(compareTasks)
    .map((task, index, arr) => build(task, 0, [], index === arr.length - 1))
    .filter((node): node is TreeNode => node !== null);
}

/** Depth-first rows for rendering, skipping the subtrees of collapsed ids. */
export function flattenTree(nodes: TreeNode[], collapsed: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const walk = (list: TreeNode[]): void => {
    for (const node of list) {
      rows.push(node);
      if (!collapsed.has(node.task.id)) walk(node.children);
    }
  };
  walk(nodes);
  return rows;
}

export interface GraphNode {
  task: Task;
  layer: number;
  x: number;
  y: number;
  blocked: boolean;
}

export interface GraphEdge {
  /** The prerequisite. */
  from: string;
  /** The task that waits for it. */
  to: string;
  /** The prerequisite is still open — this edge is what blocks. */
  blocking: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** Tasks in a dependency cycle (the API forbids it; shown instead of looping if data is bad). */
  cyclic: string[];
}

export const GRAPH_NODE_W = 200;
export const GRAPH_NODE_H = 44;
const COL_GAP = 72;
const ROW_GAP = 16;
const PAD = 16;

/**
 * Layered left-to-right layout: a task sits one column right of its deepest prerequisite.
 * Only tasks that take part in a dependency are drawn — an isolated task has nothing to show here.
 * Edges to tasks outside `tasks` are dropped.
 */
export function layoutDependencyGraph(tasks: Task[], showClosed: boolean): DependencyGraph {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const edges: GraphEdge[] = [];
  const involved = new Set<string>();
  for (const task of tasks) {
    for (const depId of task.dependencyIds) {
      const dep = byId.get(depId);
      if (!dep || dep.id === task.id) continue;
      if (!showClosed && isTaskClosed(task.status) && isTaskClosed(dep.status)) continue;
      edges.push({ from: dep.id, to: task.id, blocking: !isTaskClosed(dep.status) && !isTaskClosed(task.status) });
      involved.add(dep.id);
      involved.add(task.id);
    }
  }

  const prerequisites = new Map<string, string[]>();
  for (const edge of edges) {
    const list = prerequisites.get(edge.to) ?? [];
    list.push(edge.from);
    prerequisites.set(edge.to, list);
  }

  const layerOf = new Map<string, number>();
  const cyclic = new Set<string>();
  const stack = new Set<string>();
  function layer(id: string): number {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) {
      cyclic.add(id);
      return 0;
    }
    stack.add(id);
    let value = 0;
    for (const dep of prerequisites.get(id) ?? []) value = Math.max(value, layer(dep) + 1);
    stack.delete(id);
    layerOf.set(id, value);
    return value;
  }
  for (const id of involved) layer(id);

  const columns = new Map<number, Task[]>();
  for (const id of involved) {
    const task = byId.get(id) as Task;
    const col = layerOf.get(id) ?? 0;
    const list = columns.get(col) ?? [];
    list.push(task);
    columns.set(col, list);
  }

  const blockedIds = openBlockers(tasks);
  const nodes: GraphNode[] = [];
  let maxRows = 0;
  for (const [col, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort(compareTasks);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((task, row) => {
      nodes.push({
        task,
        layer: col,
        x: PAD + col * (GRAPH_NODE_W + COL_GAP),
        y: PAD + row * (GRAPH_NODE_H + ROW_GAP),
        blocked: blockedIds.has(task.id)
      });
    });
  }

  const columnCount = columns.size === 0 ? 0 : Math.max(...columns.keys()) + 1;
  return {
    nodes,
    edges,
    width: columnCount === 0 ? 0 : PAD * 2 + columnCount * GRAPH_NODE_W + (columnCount - 1) * COL_GAP,
    height: maxRows === 0 ? 0 : PAD * 2 + maxRows * GRAPH_NODE_H + (maxRows - 1) * ROW_GAP,
    cyclic: [...cyclic]
  };
}
