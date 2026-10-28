/**
 * ORION-05: which chain of dependencies actually determines the plan's end date.
 *
 * This Gantt is dates-first, not a classic CPM scheduler — there is no independent
 * "duration" driving a computed finish; `startAt`/`dueAt` are already fixed by whoever set
 * them. So "critical path" here answers a narrower, honestly-scoped question: starting at the
 * row that finishes last, walk backward through `dependencyIds` always following whichever
 * prerequisite itself finishes latest (the one that could actually have delayed this row,
 * not merely one of several finished-earlier ones). That chain is "critical" in the sense
 * that pushing any single link in it later pushes the plan's end date later by the same
 * amount — a true CPM zero-float path would need real durations this data model doesn't have.
 *
 * Milestones and tasks are two separate graphs (a milestone's `dependencyIds` names other
 * milestones, a task's names other tasks — never across kinds, same as the Gantt's own arrows),
 * so the critical path is computed once per kind and the two are shown independently.
 */

export interface CriticalPathNode {
  kind: "milestone" | "task" | "header";
  id: string;
  dependencyIds: readonly string[];
  startAt: Date | null;
  dueAt: Date | null;
}

function finishTime(node: CriticalPathNode): number {
  const finish = node.dueAt ?? node.startAt;
  return finish ? finish.getTime() : -Infinity;
}

/** `${kind}:${id}` keys of every row on the single chain ending at the latest-finishing row of each kind. */
export function criticalPath(rows: readonly CriticalPathNode[]): Set<string> {
  const result = new Set<string>();
  for (const kind of ["milestone", "task"] as const) {
    const byId = new Map<string, CriticalPathNode>();
    for (const row of rows) {
      if (row.kind === kind) byId.set(row.id, row);
    }
    if (byId.size === 0) continue;

    let sink: CriticalPathNode | null = null;
    let sinkFinish = -Infinity;
    for (const node of byId.values()) {
      const f = finishTime(node);
      if (f > sinkFinish) {
        sink = node;
        sinkFinish = f;
      }
    }
    if (!sink || sinkFinish === -Infinity) continue;

    const visited = new Set<string>();
    let current: CriticalPathNode | null = sink;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.add(`${current.kind}:${current.id}`);
      let latestDep: CriticalPathNode | null = null;
      for (const depId of current.dependencyIds) {
        const dep = byId.get(depId);
        if (!dep) continue;
        if (!latestDep || finishTime(dep) > finishTime(latestDep)) latestDep = dep;
      }
      current = latestDep && finishTime(latestDep) > -Infinity ? latestDep : null;
    }
  }
  return result;
}
