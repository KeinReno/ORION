import { goalTreeProgress, type Goal, type GoalHistory } from "@orion/shared-types";

/**
 * The goals as they were at one weekly point of `history` ("как было"). Rebuilt from the task
 * counts the server reconstructed, then run through the SAME `goalTreeProgress` as today's goals.
 * The last point is "now" and returns the real goals untouched. Honest limits, shown in the UI:
 *  - a goal created after the point is left out;
 *  - past statuses are unknown, so every goal counts as active;
 *  - next steps, blockers and milestones of the past are unknown and left empty.
 */
export function goalsAt(goals: ReadonlyArray<Goal>, history: GoalHistory, index: number): Goal[] {
  const last = history.points.length - 1;
  if (index >= last || index < 0) return [...goals];
  const at = new Date(history.points[index]!).getTime();
  const kept = goals.filter((g) => new Date(g.createdAt).getTime() <= at);
  const keptIds = new Set(kept.map((g) => g.id));

  const rebuilt = kept.map((goal) => ({
    ...goal,
    status: "active" as const,
    // A parent that did not exist yet makes this a top-level goal for that moment.
    parentId: goal.parentId && keptIds.has(goal.parentId) ? goal.parentId : null,
    plans: goal.plans.map((plan) => {
      const count = history.projects[plan.projectId]?.[index] ?? { tasks: 0, closed: 0 };
      return {
        ...plan,
        tasks: count.tasks,
        closed: count.closed,
        progress: count.tasks === 0 ? null : Math.round((count.closed / count.tasks) * 100),
        nextTask: null,
        blocked: 0,
        overdue: 0,
        lastActivityAt: null,
        milestones: []
      };
    })
  }));

  const tree = goalTreeProgress(rebuilt.map((g) => ({ id: g.id, parentId: g.parentId, subWeight: g.subWeight, plans: g.plans })));
  const subCounts = new Map<string, number>();
  for (const g of rebuilt) if (g.parentId) subCounts.set(g.parentId, (subCounts.get(g.parentId) ?? 0) + 1);
  return rebuilt.map((g) => {
    const own = tree.get(g.id);
    return {
      ...g,
      subGoalCount: subCounts.get(g.id) ?? 0,
      progress: own?.progress ?? null,
      unknownPlans: own?.unknownPlans ?? 0,
      unknownSubGoals: own?.unknownSubGoals ?? 0
    };
  });
}

/** Progress of one goal then vs now, for the "тогда / сейчас" line. null = unknown on either side. */
export function progressDelta(then: number | null, now: number | null): number | null {
  return then === null || now === null ? null : now - then;
}
