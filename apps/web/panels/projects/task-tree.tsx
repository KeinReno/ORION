"use client";

import { isTaskClosed, type Task } from "@orion/shared-types";
import { Badge, CheckToggle, cx } from "@orion/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { shortDate } from "../../lib/format";
import { GRAPH_NODE_H, GRAPH_NODE_W, buildTaskTree, flattenTree, layoutDependencyGraph } from "../../lib/task-graph";

/**
 * Hierarchy view: parent → subtasks → nested subtasks. Dependencies are NOT drawn here
 * (that is the graph view); a task that waits for others only carries a "ждёт" badge
 * naming what blocks it, so the two relations stay distinguishable.
 */
export function TaskTree({
  tasks,
  showClosed,
  openTaskId,
  onToggle,
  onOpen
}: {
  tasks: Task[];
  showClosed: boolean;
  openTaskId: string | null;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => flattenTree(buildTaskTree(tasks, showClosed), collapsed), [tasks, showClosed, collapsed]);

  function toggleCollapsed(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) return <p className="text-label text-subtle-foreground">Нет задач для показа.</p>;

  return (
    <ul role="tree" aria-label="Иерархия задач" className="flex max-w-4xl flex-col">
      {rows.map(({ task, depth, children, blockedBy, childTotal, childClosed }) => {
        const closed = isTaskClosed(task.status);
        const hasChildren = children.length > 0;
        const isCollapsed = collapsed.has(task.id);
        return (
          <li
            key={task.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            aria-selected={openTaskId === task.id}
            style={{ paddingLeft: depth * 20 }}
            className={cx(
              "flex items-center gap-1.5 rounded-lg px-2 py-row transition-colors hover:bg-card-hover",
              openTaskId === task.id && "bg-card-hover"
            )}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(task.id)}
                aria-label={isCollapsed ? "Развернуть" : "Свернуть"}
                className="rounded p-0.5 text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="inline-block w-[1.125rem]" aria-hidden />
            )}
            <CheckToggle
              checked={task.status === "done"}
              onClick={() => onToggle(task)}
              label={task.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
              disabled={task.status === "canceled"}
              size="sm"
            />
            <button
              type="button"
              onClick={() => onOpen(task)}
              className={cx(
                "min-w-0 flex-1 truncate text-left text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                closed ? "text-subtle-foreground line-through" : "text-foreground hover:underline"
              )}
            >
              {task.title}
            </button>
            {childTotal > 0 ? (
              <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">
                {childClosed}/{childTotal}
              </span>
            ) : null}
            {blockedBy.length > 0 ? (
              <span title={`Ждёт: ${blockedBy.map((b) => b.title).join(", ")}`} className="shrink-0">
                <Badge tone="warning">ждёт {blockedBy.length}</Badge>
              </span>
            ) : null}
            {task.dueAt ? <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">{shortDate(task.dueAt)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Dependency view: arrows run from a prerequisite to the task that waits for it. A solid
 * accent arrow is an edge that is blocking right now; a faint one points from a finished
 * task. Only tasks that take part in some dependency are drawn.
 */
export function TaskDependencyGraph({
  tasks,
  showClosed,
  openTaskId,
  onOpen
}: {
  tasks: Task[];
  showClosed: boolean;
  openTaskId: string | null;
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const graph = useMemo(() => layoutDependencyGraph(tasks, showClosed), [tasks, showClosed]);
  const position = useMemo(() => new Map(graph.nodes.map((n) => [n.task.id, n])), [graph]);

  if (graph.nodes.length === 0) {
    return (
      <p className="text-label text-subtle-foreground">
        Зависимостей между задачами нет. Добавьте их в панели задачи — «ждёт завершения» — и они появятся здесь.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {graph.cyclic.length > 0 ? (
        <p role="alert" className="text-label text-destructive">
          В зависимостях есть цикл — раскладка приблизительная. Разорвите его в одной из задач.
        </p>
      ) : null}
      <div className="orion-scroll overflow-auto rounded-xl border border-border">
        <svg width={graph.width} height={graph.height} role="group" aria-label="Граф зависимостей задач" className="block">
          <defs>
            <marker id="dep-arrow-blocking" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-accent" />
            </marker>
            <marker id="dep-arrow-idle" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-border" />
            </marker>
          </defs>
          {graph.edges.map((edge) => {
            const from = position.get(edge.from);
            const to = position.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + GRAPH_NODE_W;
            const y1 = from.y + GRAPH_NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + GRAPH_NODE_H / 2;
            const bend = Math.max(24, (x2 - x1) / 2);
            return (
              <path
                key={`${edge.from}>${edge.to}`}
                d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 2},${y2}`}
                fill="none"
                strokeWidth={edge.blocking ? 2 : 1.25}
                markerEnd={edge.blocking ? "url(#dep-arrow-blocking)" : "url(#dep-arrow-idle)"}
                className={edge.blocking ? "text-accent" : "text-border"}
                stroke="currentColor"
              />
            );
          })}
          {graph.nodes.map((node) => {
            const closed = isTaskClosed(node.task.status);
            return (
              <g
                key={node.task.id}
                transform={`translate(${node.x},${node.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${node.task.title}${node.blocked ? " — ждёт зависимость" : ""}`}
                onClick={() => onOpen(node.task)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(node.task);
                  }
                }}
                className="cursor-pointer focus-visible:outline-none"
              >
                <rect
                  width={GRAPH_NODE_W}
                  height={GRAPH_NODE_H}
                  rx={10}
                  className={cx(
                    "fill-card stroke-1",
                    openTaskId === node.task.id ? "stroke-accent" : node.blocked ? "stroke-warning" : "stroke-border"
                  )}
                />
                <text x={12} y={GRAPH_NODE_H / 2 - 3} className={cx("text-[12px]", closed ? "fill-subtle-foreground" : "fill-foreground")} textDecoration={closed ? "line-through" : undefined}>
                  {node.task.title.length > 26 ? `${node.task.title.slice(0, 25)}…` : node.task.title}
                </text>
                <text x={12} y={GRAPH_NODE_H / 2 + 12} className="fill-subtle-foreground text-[10px]">
                  {node.blocked ? "ждёт зависимость" : closed ? "готово" : "можно начинать"}
                  {node.task.dueAt ? ` · ${shortDate(node.task.dueAt)}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
