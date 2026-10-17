import {
  checkGoalParent,
  goalPace,
  milestoneWindow,
  type Goal,
  type GoalMilestone,
  type GoalNextTask,
  type GoalPace
} from "@orion/shared-types";

/**
 * Goals as constellations (second view of the Goals panel). Every top-level goal is one
 * constellation: the goal is its brightest star, sub-goals and plans (projects) are stars on
 * branches growing down from the outcome. A person reads their route upwards,
 * from the first concrete step at the bottom to the intended result at the top.
 * Pure functions, no React: the view only draws what is computed here.
 */

export const CONSTELLATION_W = 560;
export const CONSTELLATION_H = 420;

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
  kind: "goal" | "plan" | "milestone";
  /** The goal this star is (goal) or belongs to (plan / milestone). */
  goalId: string;
  planId: string | null;
  projectId: string | null;
  milestoneId: string | null;
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
function milestoneChain(goal: Goal, plan: Goal["plans"][number], live: boolean, now: Date): Item[] {
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
      label: m.title,
      progress,
      state: starState(progress, goal.status === "dropped" ? "dropped" : "active"),
      dueAt: m.dueAt,
      weight: 1,
      facts: { ...NO_FACTS, overdue: late ? 1 : 0, frontier: live && m === firstOpen },
      children: [],
      leaves: 1
    };
  });
  for (let i = items.length - 1; i > 0; i -= 1) items[i]!.children = [items[i - 1]!];
  return items.slice(-1);
}

/** Does this milestone chain still have an unfinished waypoint that the view pulses? */
function hasPulse(item: Item): boolean {
  return item.facts.frontier || item.children.some(hasPulse);
}

/** Items below a goal: its plans first, then sub-goals. Cycles / depth in bad data cannot hang the walk. */
function buildItem(goal: Goal, byParent: Map<string, Goal[]>, weight: number, seen: Set<string>, now: Date, usage: Map<string, Set<string>>): Item {
  seen.add(goal.id);
  const goalLive = goal.status === "active";
  const children: Item[] = goal.plans.map((plan) => {
    const state = starState(plan.progress, goal.status === "dropped" ? "dropped" : "active");
    const open = plan.tasks - plan.closed > 0;
    const idle = plan.lastActivityAt === null ? 0 : now.getTime() - new Date(plan.lastActivityAt).getTime();
    const ready = goalLive && plan.nextTask !== null && state !== "done";
    const chain = milestoneChain(goal, plan, goalLive && state !== "done", now);
    return {
      id: `${goal.id}:${plan.id}`,
      kind: "plan" as const,
      goalId: goal.id,
      planId: plan.id,
      projectId: plan.projectId,
      milestoneId: null,
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
      children: chain,
      leaves: 1
    };
  });
  for (const sub of byParent.get(goal.id) ?? []) {
    if (!seen.has(sub.id)) children.push(buildItem(sub, byParent, sub.subWeight, seen, now, usage));
  }
  return {
    id: goal.id,
    kind: "goal",
    goalId: goal.id,
    planId: null,
    projectId: null,
    milestoneId: null,
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
export function buildConstellations(goals: ReadonlyArray<Goal>, now: Date = new Date()): Constellation[] {
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
  return roots.map((root) => layout(buildItem(root, byParent, 1, new Set(), now, usage)));
}

function layout(root: Item): Constellation {
  const stars: Star[] = [];
  const links: Link[] = [];
  const maxDepth = depthOf(root);
  // Sparse trees stay composed near the centre instead of stretching two stars
  // to opposite edges of the canvas. Dense trees can use the full height.
  const span = Math.min(CONSTELLATION_H - 106, Math.max(138, maxDepth * 94));
  const top = (CONSTELLATION_H - span) / 2;
  const bottom = top + span;
  const left = 48;
  const width = CONSTELLATION_W - left * 2;

  function place(item: Item, parent: Star | null, depth: number, start: number, end: number, share: number): void {
    const x = left + ((start + end) / 2) * width;
    const y = maxDepth === 0 ? CONSTELLATION_H / 2 : top + (depth / maxDepth) * (bottom - top);
    const star: Star = {
      id: item.id,
      kind: item.kind,
      goalId: item.goalId,
      planId: item.planId,
      projectId: item.projectId,
      milestoneId: item.milestoneId,
      label: item.label,
      parentId: parent?.id ?? null,
      depth,
      x,
      y,
      r: item.kind === "goal" ? (depth === 0 ? 13 : 9) : item.kind === "milestone" ? 5 : 5 + share * 4,
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

function depthOf(item: Item): number {
  return item.children.reduce((max, child) => Math.max(max, depthOf(child) + 1), 0);
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
    x: unit(`${seed}x${i}`) * CONSTELLATION_W,
    y: unit(`${seed}y${i}`) * CONSTELLATION_H,
    r: 0.5 + unit(`${seed}r${i}`) * 0.9,
    o: 0.15 + unit(`${seed}o${i}`) * 0.35
  }));
}
