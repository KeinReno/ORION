"use client";

import { isTaskClosed, type Milestone, type Task } from "@orion/shared-types";
import { CheckToggle, DropdownMenu, IconButton, cx, useResizeWidth } from "@orion/ui";
import { MoreHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { shortDate } from "../../lib/format";
import {
  NO_MILESTONE_KEY,
  URGENCY_LABEL,
  buildTaskMatrix,
  type MatrixColumn,
  type UrgencyRow
} from "../../lib/project-matrix";

/** Under this width the grid would show one milestone column at a time: the matrix becomes urgency groups instead. */
const STACK_MAX = 640;

const ROW_TONE: Record<UrgencyRow, string> = {
  overdue: "text-destructive",
  today: "text-warning",
  week: "text-foreground",
  later: "text-muted-foreground",
  none: "text-subtle-foreground",
  closed: "text-subtle-foreground"
};

const ROW_EDGE: Record<UrgencyRow, string> = {
  overdue: "border-l-destructive",
  today: "border-l-warning",
  week: "border-l-accent",
  later: "border-l-border-strong",
  none: "border-l-border",
  closed: "border-l-success/50"
};

/**
 * The project's tasks on two axes: DIRECTION across (its milestones, then
 * "Без вехи") and URGENCY down. It shows both at once — what is burning and in
 * which part of the project — which a flat list cannot. Moving a card to another
 * column changes its milestone (drag it, or use the card's menu — the menu is the
 * keyboard / touch path); urgency comes from the deadline and is edited on the
 * task, never by dropping, so a drop can't silently invent a date.
 */
export function TaskMatrix({
  tasks,
  milestones,
  includeClosed,
  onToggle,
  onOpen,
  onMove
}: {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  includeClosed: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  /** `milestoneId` null = "Без вехи". */
  onMove: (task: Task, milestoneId: string | null) => void;
}): React.ReactElement {
  const now = new Date();
  const matrix = buildTaskMatrix(tasks, milestones, includeClosed, now);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [frameRef, frameWidth] = useResizeWidth<HTMLDivElement>();
  const columnTemplate = `7.5rem repeat(${matrix.columns.length}, minmax(13.5rem, 1fr))`;
  const destinations = [
    ...matrix.columns.filter((c) => c.milestone).map((c) => ({ id: c.milestone!.id, title: c.milestone!.title })),
    { id: null as string | null, title: "Без вехи" }
  ];

  function dropOn(columnKey: string, event: React.DragEvent): void {
    event.preventDefault();
    setOverKey(null);
    const id = event.dataTransfer.getData("text/plain");
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    const target = columnKey === NO_MILESTONE_KEY ? null : columnKey;
    if ((task.milestoneId ?? null) !== target) onMove(task, target);
  }

  // One measured wrapper for both layouts: the width observer is attached once, to this element.
  return <div ref={frameRef}>{frameWidth > 0 && frameWidth < STACK_MAX ? renderStacked() : renderGrid()}</div>;

  function renderStacked(): React.ReactElement {
    // Narrow panel or phone: a 13.5rem column per milestone left only the first one on screen,
    // so tasks of «Без вехи» sat off to the right with nothing saying they were there. Same
    // cards, grouped by urgency; the milestone is named on each card and moved through its menu.
    const titles = new Map(matrix.columns.map((column) => [column.key, column.milestone?.title ?? "Без вехи"]));
    return (
      <div className="flex flex-col gap-4" role="list" aria-label="Задачи по срочности">
        {matrix.rows.length === 0 ? (
          <p className="rounded-xl border border-border px-3 py-6 text-center text-label text-subtle-foreground">Открытых задач нет.</p>
        ) : (
          matrix.rows.map((row) => (
            <section key={row} role="listitem" aria-label={URGENCY_LABEL[row]} className="flex flex-col gap-1">
              <h3 className={cx("border-l-2 px-2 text-label", ROW_TONE[row], ROW_EDGE[row])}>{URGENCY_LABEL[row]}</h3>
              {matrix.columns.flatMap((column) =>
                (matrix.cells[row]?.[column.key] ?? []).map((task) => (
                  <MatrixCard
                    key={task.id}
                    task={task}
                    row={row}
                    milestoneTitle={titles.get(column.key)}
                    destinations={destinations.filter((d) => d.id !== (task.milestoneId ?? null))}
                    onToggle={() => onToggle(task)}
                    onOpen={() => onOpen(task)}
                    onMove={(milestoneId) => onMove(task, milestoneId)}
                  />
                ))
              )}
            </section>
          ))
        )}
      </div>
    );
  }

  function renderGrid(): React.ReactElement {
    return (
      <div className="orion-scroll overflow-x-auto rounded-xl border border-border">
        <div className="grid min-w-full" style={{ gridTemplateColumns: columnTemplate }} role="table" aria-label="Задачи по направлениям и срочности">
          <div role="row" className="contents">
            <div role="columnheader" className="border-b border-border px-2 py-2 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
              Срочность
            </div>
            {matrix.columns.map((column) => (
              <ColumnHeader key={column.key} column={column} />
            ))}
          </div>

          {matrix.rows.length === 0 ? (
            <p className="col-span-full px-3 py-6 text-center text-label text-subtle-foreground">Открытых задач нет.</p>
          ) : (
            matrix.rows.map((row) => (
              <div key={row} role="row" className="contents">
                <div
                  role="rowheader"
                  className={cx("border-b border-l-2 border-border px-2 py-2 text-label", ROW_TONE[row], ROW_EDGE[row])}
                >
                  {URGENCY_LABEL[row]}
                </div>
                {matrix.columns.map((column) => {
                  const cellKey = `${row}:${column.key}`;
                  const list = matrix.cells[row]?.[column.key] ?? [];
                  return (
                    <div
                      key={cellKey}
                      role="cell"
                      onDragOver={(event) => {
                        event.preventDefault();
                        setOverKey(column.key);
                      }}
                      onDragLeave={() => setOverKey((cur) => (cur === column.key ? null : cur))}
                      onDrop={(event) => dropOn(column.key, event)}
                      className={cx(
                        "flex min-h-[3rem] flex-col gap-1 border-b border-border/60 p-1.5 transition-colors",
                        overKey === column.key && "bg-accent/[0.06]"
                      )}
                    >
                      {list.map((task) => (
                        <MatrixCard
                          key={task.id}
                          task={task}
                          row={row}
                          destinations={destinations.filter((d) => d.id !== (task.milestoneId ?? null))}
                          onToggle={() => onToggle(task)}
                          onOpen={() => onOpen(task)}
                          onMove={(milestoneId) => onMove(task, milestoneId)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
}

function ColumnHeader({ column }: { column: MatrixColumn }): React.ReactElement {
  const total = column.open + column.closed;
  return (
    <div role="columnheader" className="border-b border-border px-2 py-2">
      <p className="truncate text-label text-foreground" title={column.milestone?.title ?? "Без вехи"}>
        {column.milestone?.title ?? "Без вехи"}
      </p>
      <p className="text-micro text-subtle-foreground">
        {total === 0 ? "нет задач" : <span className="font-mono tabular-nums">{column.closed}/{total}</span>}
        {column.milestone?.dueAt ? ` · до ${shortDate(column.milestone.dueAt)}` : ""}
      </p>
    </div>
  );
}

function MatrixCard({
  task,
  row,
  milestoneTitle,
  destinations,
  onToggle,
  onOpen,
  onMove
}: {
  task: Task;
  row: UrgencyRow;
  /** Shown only in the stacked layout, where there is no column header to say it. */
  milestoneTitle?: string;
  destinations: { id: string | null; title: string }[];
  onToggle: () => void;
  onOpen: () => void;
  onMove: (milestoneId: string | null) => void;
}): React.ReactElement {
  const cardId = useId();
  const closed = isTaskClosed(task.status);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cx(
        "group flex cursor-grab items-start gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 active:cursor-grabbing",
        "border-l-2",
        ROW_EDGE[row],
        closed && "opacity-70"
      )}
    >
      <div className="pt-0.5">
        <CheckToggle
          checked={task.status === "done"}
          onClick={onToggle}
          label={task.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
          disabled={task.status === "canceled"}
          size="sm"
        />
      </div>
      {/* Named by the title alone, the meta line is its description: the stacked layout adds the milestone there,
          and the task must keep the same name in both layouts. */}
      <button
        type="button"
        onClick={onOpen}
        title="Открыть задачу"
        aria-labelledby={`${cardId}-title`}
        aria-describedby={`${cardId}-meta`}
        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span id={`${cardId}-title`} className={cx("block text-label", closed ? "text-subtle-foreground line-through" : "text-foreground")}>{task.title}</span>
        <span id={`${cardId}-meta`} className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-subtle-foreground">
          {milestoneTitle ? <span className="min-w-0 truncate">{milestoneTitle}</span> : null}
          {task.dueAt ? <span className={cx("font-mono tabular-nums", row === "overdue" && "text-destructive")}>{shortDate(task.dueAt)}</span> : null}
          {!closed && task.priority === "high" ? <span className="text-warning">высокий</span> : null}
          {task.status === "in_progress" ? <span className="text-accent-text">в работе</span> : null}
          {!closed && task.blocked ? <span className="text-warning">ждёт зависимость</span> : null}
        </span>
      </button>
      {destinations.length > 0 ? (
        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
          <DropdownMenu
            align="end"
            trigger={({ toggle }) => (
              <IconButton label={`Перенести «${task.title}» в другое направление`} size="sm" onClick={toggle}>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </IconButton>
            )}
            items={destinations.map((destination) => ({
              label: `В «${destination.title}»`,
              onSelect: () => onMove(destination.id)
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}
