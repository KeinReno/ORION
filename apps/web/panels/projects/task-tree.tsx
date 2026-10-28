"use client";

import { isTaskClosed, type Task } from "@orion/shared-types";
import { Badge, CheckToggle, cx, IconButton, StrikeText, useContextMenuApi, useToast } from "@orion/ui";
import { ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { shortDate } from "../../lib/format";
import { descendantIds } from "../../lib/task-structure";
import { GRAPH_NODE_H, GRAPH_NODE_W, buildTaskTree, flattenTree, layoutDependencyGraph } from "../../lib/task-graph";

/** The same `text/plain` task-id convention `TaskCard`/the board drag already use — one MIME, not a new one per view. */
const TASK_DRAG_MIME = "text/plain";

/**
 * Hierarchy view: parent → subtasks → nested subtasks. Dependencies are NOT drawn here
 * (that is the graph view); a task that waits for others only carries a "ждёт" badge
 * naming what blocks it, so the two relations stay distinguishable.
 *
 * ORION-02: a row is draggable onto another row to reparent (cycle-blocked client-side via
 * `descendantIds`, same guard `parentOptions` uses for the detail pane's select — the server
 * re-checks regardless). Inline "+" creates a child with just a title, no modal; double-click
 * (or the pencil on hover) renames in place. Both commit through the same `onReparent`/
 * `onCreateChild`/`onRename` the caller already uses for every other task mutation here.
 */
export function TaskTree({
  tasks,
  showClosed,
  openTaskId,
  onToggle,
  onOpen,
  onReparent,
  onCreateChild,
  onRename
}: {
  tasks: Task[];
  showClosed: boolean;
  openTaskId: string | null;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  /** `parentId: null` moves the task to the root. Declined (cycle, same task) calls never fire. */
  onReparent: (taskId: string, parentId: string | null) => void;
  onCreateChild: (parent: Task, title: string) => void;
  onRename: (task: Task, title: string) => void;
}): React.ReactElement {
  const { toast } = useToast();
  const showContextMenu = useContextMenuApi();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const draggingDescendants = useRef<Set<string>>(new Set());
  const rows = useMemo(() => flattenTree(buildTaskTree(tasks, showClosed), collapsed), [tasks, showClosed, collapsed]);

  function toggleCollapsed(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function dropIsValid(targetId: string): boolean {
    return draggingId !== null && draggingId !== targetId && !draggingDescendants.current.has(targetId);
  }

  if (rows.length === 0) return <p className="text-label text-subtle-foreground">Нет задач для показа.</p>;

  return (
    <ul role="tree" aria-label="Иерархия задач" className="flex max-w-4xl flex-col">
      {rows.map(({ task, depth, children, blockedBy, childTotal, childClosed }) => {
        const closed = isTaskClosed(task.status);
        const hasChildren = children.length > 0;
        const isCollapsed = collapsed.has(task.id);
        const isRenaming = renamingId === task.id;
        const rowMenuItems = [
          { label: "Открыть", onSelect: () => onOpen(task) },
          { label: "Переименовать", icon: Pencil, onSelect: () => setRenamingId(task.id) },
          { label: "Добавить подзадачу", icon: Plus, onSelect: () => setAddingChildFor(task.id) },
          ...(task.parentId ? ["separator" as const, { label: "Сделать верхнего уровня", onSelect: () => onReparent(task.id, null) }] : [])
        ];
        return (
          <li key={task.id} className="flex flex-col">
            <div
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              aria-selected={openTaskId === task.id}
              style={{ paddingLeft: depth * 20 }}
              onContextMenu={(e) => showContextMenu(e, rowMenuItems)}
              draggable={!isRenaming}
              onDragStart={(event) => {
                event.dataTransfer.setData(TASK_DRAG_MIME, task.id);
                event.dataTransfer.effectAllowed = "move";
                draggingDescendants.current = descendantIds(tasks, task.id);
                setDraggingId(task.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              onDragOver={(event) => {
                if (!dropIsValid(task.id)) return;
                event.preventDefault();
                setDragOverId(task.id);
              }}
              onDragLeave={() => setDragOverId((current) => (current === task.id ? null : current))}
              onDrop={(event) => {
                setDragOverId(null);
                const draggedId = event.dataTransfer.getData(TASK_DRAG_MIME);
                if (!draggedId || draggedId === task.id) return;
                event.preventDefault();
                if (draggingDescendants.current.has(task.id)) {
                  toast({ title: "Нельзя перенести задачу в её собственную подзадачу", tone: "danger" });
                  return;
                }
                onReparent(draggedId, task.id);
              }}
              className={cx(
                "group flex items-center gap-1.5 rounded-lg px-2 py-row transition-colors hover:bg-card-hover",
                openTaskId === task.id && "bg-card-hover",
                draggingId === task.id && "opacity-50",
                dragOverId === task.id && "outline outline-2 outline-accent"
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
              {isRenaming ? (
                <RenameField
                  initial={task.title}
                  onCommit={(title) => {
                    setRenamingId(null);
                    if (title.trim() && title.trim() !== task.title) onRename(task, title.trim());
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    setRenamingId(task.id);
                  }}
                  className={cx(
                    "min-w-0 flex-1 truncate text-left text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    closed ? "text-subtle-foreground" : "text-foreground hover:underline"
                  )}
                >
                  <StrikeText done={closed}>{task.title}</StrikeText>
                </button>
              )}
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
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <IconButton label="Переименовать" size="sm" onClick={() => setRenamingId(task.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="Добавить подзадачу" size="sm" onClick={() => setAddingChildFor(task.id)}>
                  <Plus className="h-3.5 w-3.5" />
                </IconButton>
              </span>
            </div>
            {addingChildFor === task.id ? (
              <div style={{ paddingLeft: (depth + 1) * 20 }} className="flex items-center gap-1.5 px-2 py-row">
                <span className="inline-block w-[1.125rem]" aria-hidden />
                <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                <RenameField
                  initial=""
                  placeholder="Название подзадачи…"
                  onCommit={(title) => {
                    setAddingChildFor(null);
                    if (title.trim()) onCreateChild(task, title.trim());
                  }}
                  onCancel={() => setAddingChildFor(null)}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Autofocused inline text field — Enter commits, Escape or blur-without-change cancels. Used for both rename and inline "add child". */
function RenameField({
  initial,
  placeholder,
  onCommit,
  onCancel
}: {
  initial: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  const committedRef = useRef(false);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          committedRef.current = true;
          onCommit(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (committedRef.current) return;
        committedRef.current = true;
        if (value.trim()) onCommit(value);
        else onCancel();
      }}
      className="min-w-0 flex-1 rounded-md border border-accent/60 bg-background px-1.5 py-0.5 text-label text-foreground focus-visible:outline-none"
    />
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
