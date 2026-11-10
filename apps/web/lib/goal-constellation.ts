import {
  checkGoalParent,
  goalPace,
  milestoneWindow,
  type Goal,
  type GoalMilestone,
  type GoalNextTask,
  type GoalPace,
  type Task
} from "@orion/shared-types";

/**
 * Goals as constellations (second view of the Goals panel). Every top-level goal is one
 * constellation: the goal is its brightest star, sub-goals and plans (projects) are stars on
 * branches growing down from the outcome. A person reads their route upwards,
 * from the first concrete step at the bottom to the intended result at the top.
 * Pure functions, no React: the view only draws what is computed here.
 */

/** Screen-space viewport dimensions. World coordinates are not bounded by these values. */
export const SKY_VIEWPORT_W = 960;
export const SKY_VIEWPORT_H = 640;

/** A plan with open work and no change for this long is "стоит". */
export const STALLED_DAYS = 14;
const DAY_MS = 86_400_000;

/** done = fully lit, lit = some progress, dim = known but zero, unknown = no tasks yet (never drawn as 0), dropped = abandoned. */
export type StarState = "done" | "lit" | "dim" | "unknown" | "dropped";

/** Which stars the view emphasises; everything else fades. */
export type Lens = "progress" | "focus" | "stuck";

export interface Star {
  /** Goal id for a goal; `${goalId}:${planId}` for a plan; `${goalId}:${planId}:${milestoneId}` for a milestone. */
  id: string;
  /** A milestone is a waypoint on a plan's branch; the earliest step is lowest in the drawing. */
  kind: "goal" | "plan" | "milestone" | "task";
  /** The goal this star is (goal) or belongs to (plan / milestone). */
  goalId: string;
  planId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  taskId: string | null;
  label: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  /** Drawn radius; grows with the weight share among siblings. */
  r: number;
  progress: number | null;
  state: StarState;
  dueAt: string | null;
  /** Weight inside the parent (plan weight or sub-goal weight). */
  weight: number;
  /** weight / sum of sibling weights, 0..1. */
  share: number;
  nextTask: GoalNextTask | null;
  blocked: number;
  overdue: number;
  lastActivityAt: string | null;
  /** Open work, but nothing moved for STALLED_DAYS. */
  stalled: boolean;
  /** A plan with a task ready to do (whatever else its branch shows). */
  ready: boolean;
  /** Where the branch is "now", the one star the view pulses: the first unfinished milestone, or the plan itself when it has none. */
  frontier: boolean;
  /** Deadline pace of a goal star; { state: "none" } for everything else. */
  pace: GoalPace;
  /** Other goals served by the same project (plans only). */
  sharedWith: string[];
}

export interface Link {
  from: string;
  to: string;
  /** The route is lit when the star it leads to has any known progress. */
  lit: boolean;
  /** Share of the parent's progress this branch carries; the view uses it for line thickness. */
  share: number;
}

export interface Constellation {
  rootId: string;
  stars: Star[];
  links: Link[];
}

export function starState(progress: number | null, status: Goal["status"] | "active"): StarState {
  if (status === "dropped") return "dropped";
  if (status === "achieved" || progress === 100) return "done";
  if (progress === null) return "unknown";
  return progress > 0 ? "lit" : "dim";
}

/** Stable 0..1 from a string, so the "hand-drawn" jitter never changes between renders. */
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

type Facts = Pick<Star, "nextTask" | "blocked" | "overdue" | "lastActivityAt" | "stalled" | "frontier" | "ready" | "pace" | "sharedWith">;
const NO_PACE: GoalPace = { state: "none", elapsed: null };
const NO_FACTS: Facts = {
  nextTask: null,
  blocked: 0,
  overdue: 0,
  lastActivityAt: null,
  stalled: false,
  frontier: false,
  ready: false,
  pace: NO_PACE,
  sharedWith: []
};

interface Item {
  id: string;
  kind: Star["kind"];
  goalId: string;
  planId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  taskId: string | null;
  label: string;
  progress: number | null;
  state: StarState;
  dueAt: string | null;
  weight: number;
  facts: Facts;
  children: Item[];
  leaves: number;
}

/** A milestone's own progress: its tasks' share; a done milestone is 100 whatever its tasks say; no tasks = unknown. */
function milestoneProgress(m: GoalMilestone): number | null {
  if (m.status === "done") return 100;
  return m.tasks === 0 ? null : Math.round((m.closed / m.tasks) * 100);
}

/** The milestone chain of a plan, nested so each waypoint hangs on the previous one (a path, not a fan). Returns its head. */
function taskItem(goal: Goal, plan: Goal["plans"][number], task: Task, now: Date): Item {
  const done = task.status === "done" || task.status === "canceled";
  const overdue = !done && task.dueAt !== null && new Date(task.dueAt).getTime() < now.getTime();
  return {
    id: `${goal.id}:${plan.id}:task:${task.id}`,
    kind: "task", goalId: goal.id, planId: plan.id, projectId: plan.projectId,
    milestoneId: task.milestoneId, taskId: task.id, label: task.title,
    progress: done ? 100 : 0,
    state: done ? "done" : task.status === "in_progress" ? "lit" : "dim",
    dueAt: task.dueAt, weight: 1,
    facts: { ...NO_FACTS, blocked: task.blocked ? 1 : 0, overdue: overdue ? 1 : 0, ready: !done && !task.blocked, frontier: plan.nextTask?.id === task.id },
    children: [], leaves: 1
  };
}

function milestoneChain(goal: Goal, plan: Goal["plans"][number], live: boolean, now: Date, tasks: ReadonlyArray<Task>): Item[] {
  const shown = milestoneWindow(plan.milestones);
  const firstOpen = shown.find((m) => m.status !== "done");
  const items = shown.map<Item>((m) => {
    const progress = milestoneProgress(m);
    const late = m.status !== "done" && m.dueAt !== null && new Date(m.dueAt).getTime() < now.getTime();
    return {
      id: `${goal.id}:${plan.id}:${m.id}`,
      kind: "milestone",
      goalId: goal.id,
      planId: plan.id,
      projectId: plan.projectId,
      milestoneId: m.id,
      taskId: null,
      label: m.title,
      progress,
      state: starState(progress, goal.status === "dropped" ? "dropped" : "active"),
      dueAt: m.dueAt,
      weight: 1,
      facts: { ...NO_FACTS, overdue: late ? 1 : 0, frontier: live && m === firstOpen },
      children: tasks.filter((task) => task.milestoneId === m.id).map((task) => taskItem(goal, plan, task, now)),
      leaves: 1
    };
  });
  for (let i = items.length - 1; i > 0; i -= 1) items[i]!.children.unshift(items[i - 1]!);
  for (const item of items) item.leaves = Math.max(1, item.children.reduce((sum, child) => sum + child.leaves, 0));
  return items.slice(-1);
}

/** Does this milestone chain still have an unfinished waypoint that the view pulses? */
function hasPulse(item: Item): boolean {
  return item.facts.frontier || item.children.some(hasPulse);
}

/** Items below a goal: its plans first, then sub-goals. Cycles / depth in bad data cannot hang the walk. */
function buildItem(goal: Goal, byParent: Map<string, Goal[]>, weight: number, seen: Set<string>, now: Date, usage: Map<string, Set<string>>, tasks: ReadonlyArray<Task>): Item {
  seen.add(goal.id);
  const goalLive = goal.status === "active";
  const children: Item[] = goal.plans.map((plan) => {
    const state = starState(plan.progress, goal.status === "dropped" ? "dropped" : "active");
    const open = plan.tasks - plan.closed > 0;
    const idle = plan.lastActivityAt === null ? 0 : now.getTime() - new Date(plan.lastActivityAt).getTime();
    const ready = goalLive && plan.nextTask !== null && state !== "done";
    const projectTasks = tasks.filter((task) => task.projectId === plan.projectId);
    const chain = milestoneChain(goal, plan, goalLive && state !== "done", now, projectTasks);
    const shownMilestones = new Set(milestoneWindow(plan.milestones).map((milestone) => milestone.id));
    const directTasks = projectTasks.filter((task) => !task.milestoneId || !shownMilestones.has(task.milestoneId)).map((task) => taskItem(goal, plan, task, now));
    return {
      id: `${goal.id}:${plan.id}`,
      kind: "plan" as const,
      goalId: goal.id,
      planId: plan.id,
      projectId: plan.projectId,
      milestoneId: null,
      taskId: null,
      label: plan.projectName,
      progress: plan.progress,
      state,
      dueAt: null,
      weight: plan.weight,
      facts: {
        nextTask: plan.nextTask,
        blocked: plan.blocked,
        overdue: plan.overdue,
        lastActivityAt: plan.lastActivityAt,
        stalled: goalLive && open && state !== "done" && idle > STALLED_DAYS * DAY_MS,
        ready,
        // The pulse sits on the first unfinished milestone when the branch has one; otherwise on the plan.
        frontier: ready && !chain.some(hasPulse),
        pace: NO_PACE,
        sharedWith: [...(usage.get(plan.projectId) ?? [])].filter((id) => id !== goal.id)
      },
      children: [...chain, ...directTasks],
      leaves: Math.max(1, [...chain, ...directTasks].reduce((sum, child) => sum + child.leaves, 0))
    };
  });
  for (const sub of byParent.get(goal.id) ?? []) {
    if (!seen.has(sub.id)) children.push(buildItem(sub, byParent, sub.subWeight, seen, now, usage, tasks));
  }
  return {
    id: goal.id,
    kind: "goal",
    goalId: goal.id,
    planId: null,
    projectId: null,
    milestoneId: null,
    taskId: null,
    label: goal.title,
    progress: goal.progress,
    state: starState(goal.progress, goal.status),
    dueAt: goal.dueAt,
    weight,
    facts: { ...NO_FACTS, pace: goalPace(goal, now) },
    children,
    leaves: Math.max(1, children.reduce((sum, child) => sum + child.leaves, 0))
  };
}

/**
 * One constellation per top-level goal (a goal whose parent is outside the list also counts as a
 * root, so nothing silently disappears). Branches are laid out as a vertical tree:
 * the result is at the top, current work sits below it, and each parent is centred over its leaves.
 */
export function buildConstellations(goals: ReadonlyArray<Goal>, now: Date = new Date(), tasks: ReadonlyArray<Task> = []): Constellation[] {
  const ids = new Set(goals.map((g) => g.id));
  const byParent = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const goal of goals) {
    if (goal.parentId && goal.parentId !== goal.id && ids.has(goal.parentId)) {
      byParent.set(goal.parentId, [...(byParent.get(goal.parentId) ?? []), goal]);
    } else {
      roots.push(goal);
    }
  }
  // Which goals each project serves, so a project shared by two goals is visible from both.
  const usage = new Map<string, Set<string>>();
  for (const goal of goals) {
    for (const plan of goal.plans) usage.set(plan.projectId, (usage.get(plan.projectId) ?? new Set()).add(goal.id));
  }
  return roots.map((root) => layout(buildItem(root, byParent, 1, new Set(), now, usage, tasks)));
}

function layout(root: Item): Constellation {
  const stars: Star[] = [];
  const links: Link[] = [];
  // Reserve enough horizontal room for every leaf label plus its hit target.
  // The resulting world grows with the data instead of compressing a large tree.
  const columnGap = 230;
  const rowGap = 148;
  const width = Math.max(SKY_VIEWPORT_W, root.leaves * columnGap);
  const left = Math.max(0, (SKY_VIEWPORT_W - width) / 2);
  const top = 120;

  function place(item: Item, parent: Star | null, depth: number, start: number, end: number, share: number): void {
    const x = left + ((start + end) / 2) * width;
    const y = top + depth * rowGap;
    const star: Star = {
      id: item.id,
      kind: item.kind,
      goalId: item.goalId,
      planId: item.planId,
      projectId: item.projectId,
      milestoneId: item.milestoneId,
      taskId: item.taskId,
      label: item.label,
      parentId: parent?.id ?? null,
      depth,
      x,
      y,
      r: item.kind === "goal" ? (depth === 0 ? 13 : 9) : item.kind === "milestone" ? 5 : item.kind === "task" ? 4.5 : 5 + share * 4,
      progress: item.progress,
      state: item.state,
      dueAt: item.dueAt,
      weight: item.weight,
      share,
      ...item.facts
    };
    stars.push(star);
    if (parent) links.push({ from: parent.id, to: star.id, lit: item.state === "done" || item.state === "lit", share });
    const totalWeight = item.children.reduce((sum, child) => sum + child.weight, 0) || 1;
    let cursor = start;
    for (const child of item.children) {
      const span = ((end - start) * child.leaves) / item.leaves;
      place(child, star, depth + 1, cursor, cursor + span, child.weight / totalWeight);
      cursor += span;
    }
  }

  place(root, null, 0, 0, 1, 1);
  return { rootId: root.id, stars, links };
}

/** Ids from the root down to `id` (inclusive); [] for an unknown id. This is "the path" the view highlights. */
export function pathToRoot(constellation: Constellation, id: string): string[] {
  const byId = new Map(constellation.stars.map((s) => [s.id, s]));
  const path: string[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    path.unshift(cur.id);
  }
  return path;
}

/** Stars that count as "stuck": a flagged plan, plus every ancestor so the route to it stays readable. */
function withAncestors(constellation: Constellation, seeds: ReadonlyArray<Star>): Set<string> {
  const result = new Set<string>();
  for (const seed of seeds) for (const id of pathToRoot(constellation, seed.id)) result.add(id);
  return result;
}

export function isStuck(star: Star): boolean {
  return star.stalled || star.blocked > 0 || star.overdue > 0;
}

/** Ids that stay fully visible under a lens; null = no fading at all. */
export function lensVisible(constellation: Constellation, lens: Lens): Set<string> | null {
  if (lens === "progress") return null;
  const seeds = constellation.stars.filter(lens === "focus" ? (s) => s.frontier : isStuck);
  return seeds.length === 0 ? null : withAncestors(constellation, seeds);
}

export interface SkyHealth {
  /** attention = something is overdue, blocked, stalled or behind the deadline; idle = nothing to do right now. */
  tone: "done" | "attention" | "ok" | "idle";
  overdue: number;
  blocked: number;
  stalled: number;
  /** Plans that serve another goal as well. */
  shared: number;
  /** The first plan with a ready task in reading order, for the card's "next step" line. */
  next: Star | null;
  /** Pace of the constellation's root goal. */
  pace: GoalPace;
}

export function skyHealth(constellation: Constellation): SkyHealth {
  const root = constellation.stars.find((s) => s.id === constellation.rootId);
  const plans = constellation.stars.filter((s) => s.kind === "plan");
  const milestoneOverdue = constellation.stars.filter((s) => s.kind === "milestone").reduce((n, s) => n + s.overdue, 0);
  const overdue = plans.reduce((n, s) => n + s.overdue, 0) + milestoneOverdue;
  const blocked = plans.reduce((n, s) => n + s.blocked, 0);
  const stalled = plans.filter((s) => s.stalled).length;
  const shared = plans.filter((s) => s.sharedWith.length > 0).length;
  const next = plans.find((s) => s.ready) ?? null;
  const pace = root?.pace ?? NO_PACE;
  let tone: SkyHealth["tone"] = "ok";
  if (root?.state === "done") tone = "done";
  else if (root?.state === "dropped") tone = "idle";
  else if (overdue + blocked + stalled > 0 || pace.state === "behind" || pace.state === "late") tone = "attention";
  else if (next === null) tone = "idle";
  return { tone, overdue, blocked, stalled, shared, next, pace };
}

/** Goals that `goalId` may be dropped onto (null = a new goal). Self, descendants and over-deep placements are out. */
export function validParents(goals: ReadonlyArray<Goal>, goalId: string | null): Set<string> {
  return new Set(goals.filter((g) => g.id !== goalId && checkGoalParent(goalId, g.id, goals).ok).map((g) => g.id));
}

/** Nearest star within `slack` of a point, or null. Used to resolve where something was dropped. */
export function starAt(stars: ReadonlyArray<Star>, x: number, y: number, slack = 10, accept: (s: Star) => boolean = () => true): Star | null {
  let best: Star | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const star of stars) {
    if (!accept(star)) continue;
    const d = Math.hypot(star.x - x, star.y - y);
    if (d <= star.r + slack && d < bestDistance) {
      best = star;
      bestDistance = d;
    }
  }
  return best;
}

/** Suggest a clear location for keyboard/toolbar creation. A direct canvas click keeps its exact position. */
export function suggestCanvasPoint(stars: ReadonlyArray<Star>, parent: Star): { x: number; y: number } {
  const clear = (candidate: { x: number; y: number }): boolean => stars.every((star) => {
    const dx = Math.abs(candidate.x - star.x);
    const dy = Math.abs(candidate.y - star.y);
    return Math.hypot(dx, dy) > 74 && (dx > 180 || dy > 50);
  });
  for (let ring = 1; ring < 80; ring += 1) {
    const count = Math.max(8, ring * 8);
    for (let index = 0; index < count; index += 1) {
      const angle = index * (Math.PI * 2 / count) + ring * 0.31;
      const candidate = { x: parent.x + Math.cos(angle) * ring * 105, y: parent.y + Math.sin(angle) * ring * 82 };
      if (clear(candidate)) return candidate;
    }
  }
  return { x: parent.x + 8400, y: parent.y + 6560 };
}

/** Neighbour for keyboard travel: up = parent, down = first child, left/right = previous/next sibling. */
export function neighbour(constellation: Constellation, id: string, direction: "up" | "down" | "left" | "right"): string | null {
  const star = constellation.stars.find((s) => s.id === id);
  if (!star) return null;
  if (direction === "up") return star.parentId;
  if (direction === "down") return constellation.stars.find((s) => s.parentId === id)?.id ?? null;
  const siblings = constellation.stars.filter((s) => s.parentId === star.parentId);
  const index = siblings.findIndex((s) => s.id === id);
  if (siblings.length < 2 || index < 0) return null;
  const step = direction === "right" ? 1 : -1;
  return siblings[(index + step + siblings.length) % siblings.length]!.id;
}

/** Deterministic background dust for a constellation, so the sky does not flicker on re-render. */
export function backgroundStars(seed: string, count = 34): Array<{ x: number; y: number; r: number; o: number }> {
  return Array.from({ length: count }, (_, i) => ({
    x: (unit(`${seed}x${i}`) - 0.5) * SKY_VIEWPORT_W * 2,
    y: (unit(`${seed}y${i}`) - 0.5) * SKY_VIEWPORT_H * 2,
    r: 0.5 + unit(`${seed}r${i}`) * 0.9,
    o: 0.15 + unit(`${seed}o${i}`) * 0.35
  }));
}
