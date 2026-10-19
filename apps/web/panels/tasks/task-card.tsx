import type { Task, TaskPriority, TaskStatus } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";
import { CheckToggle, cx, DropdownMenu, IconButton, type MenuItem, Tooltip, StatusMark, StrikeText } from "@orion/ui";
import { AlertCircle, ArrowDown, ArrowUp, CalendarClock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { AccountAvatar } from "../../components/account-avatar";
import { useSlotContributions } from "../../lib/extensions/slot";
import { projectColor, shortDateTime } from "../../lib/format";
import type { SubtaskProgress } from "../../lib/task-structure";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, TASK_STATUS_ORDER } from "../task-form";

/** Just enough of `WorkspaceMember` for the assignee avatar + tooltip. */
export interface TaskAssignee {
  userId: string;
  name: string;
  hasAvatar: boolean;
}

const PRIORITY_DOT: Partial<Record<TaskPriority, string>> = {
  high: "bg-destructive",
  low: "bg-subtle-foreground/50"
};

export function TaskCard({
  task,
  draggable,
  focused,
  selected,
  subtasks,
  onOpen,
  onSelect,
  onToggleDone,
  onMove,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDropTask,
  assignee,
  hideProject = false
}: {
  task: Task;
  draggable: boolean;
  focused: boolean;
  /** Клавиатурное выделение (Shift+←/→ между колонками) — не то же, что `focused` с панели. */
  selected?: boolean;
  /** Прогресс по детям этой задачи («3/5»), если они есть в пространстве. */
  subtasks?: SubtaskProgress;
  onOpen: () => void;
  onSelect?: () => void;
  onToggleDone: () => void;
  onMove: (status: TaskStatus) => void;
  onDelete: () => void;
  /** Ручной порядок доступен только в колонках статусов (см. TasksPanel). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Дроп другой задачи на эту карточку — вставка перед ней. */
  onDropTask?: (draggedId: string) => void;
  /** Исполнитель — только когда плагин «Команда» включён и задача назначена (см. TasksPanel). */
  assignee?: TaskAssignee;
  /** Внутри проекта чип проекта повторяет заголовок вкладки — не показываем. */
  hideProject?: boolean;
}): React.ReactElement {
  // The repeat mark belongs to the tasks-recurrence plugin.
  const recurrence = useSlotContributions("tasks.recurrence")[0]?.meta?.api;
  // Subtask marks, the «blocked» mark and hand-made order belong to the tasks-planning plugin.
  const planning = useSlotContributions("tasks.planning")[0]?.meta?.api;
  const done = task.status === "done";
  const canceled = task.status === "canceled";
  const closed = isTaskClosed(task.status);
  const nested = task.parentId !== null && planning !== undefined;
  const overdue = !closed && task.dueAt !== null && new Date(task.dueAt).getTime() < Date.now();

  const items: (MenuItem | "separator")[] = [{ label: "Открыть", icon: Pencil, onSelect: onOpen }];
  if (onMoveUp || onMoveDown) {
    items.push(
      "separator",
      { label: "Вверх", icon: ArrowUp, onSelect: () => onMoveUp?.(), disabled: !onMoveUp },
      { label: "Вниз", icon: ArrowDown, onSelect: () => onMoveDown?.(), disabled: !onMoveDown }
    );
  }
  items.push("separator", { label: "Удалить", icon: Trash2, tone: "danger", onSelect: onDelete });
  items.push(
    "separator",
    ...TASK_STATUS_ORDER.filter((status) => status !== task.status).map((status) => ({
      label: TASK_STATUS_LABEL[status],
      onSelect: () => onMove(status)
    }))
  );

  return (
    <div
      id={`task-${task.id}`}
      tabIndex={0}
      draggable={draggable}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
      onDragOver={(event) => {
        if (onDropTask) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!onDropTask) return;
        // Иначе дроп всплывёт до колонки и обработается как смена группы.
        event.preventDefault();
        event.stopPropagation();
        const draggedId = event.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== task.id) onDropTask(draggedId);
      }}
      onClick={() => {
        onSelect?.();
        onOpen();
      }}
      onFocus={() => onSelect?.()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSelect?.();
          onOpen();
        }
      }}
      className={cx(
        "group relative flex cursor-pointer flex-col gap-2 rounded-2xl border bg-card px-3 py-card-row transition-colors hover:border-border-strong hover:bg-card-hover",
        focused || selected ? "border-accent" : "border-border",
        nested && "ml-4",
        closed && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        {nested ? (
          <span aria-hidden className="mt-0.5 shrink-0 select-none font-mono text-micro leading-4 text-subtle-foreground">
            └
          </span>
        ) : null}
        <div className="mt-0.5" onClick={(event) => event.stopPropagation()} role="presentation">
          <CheckToggle
            checked={done}
            onClick={onToggleDone}
            label={done ? "Вернуть в работу" : "Отметить выполненной"}
            shape="circle"
            size="sm"
            tone="success"
          />
        </div>
        {PRIORITY_DOT[task.priority] ? <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} title={`Приоритет: ${TASK_PRIORITY_LABEL[task.priority]}`} /> : null}
        <span className="flex-1 text-body font-medium"><StrikeText done={done || canceled}>{task.title}</StrikeText></span>
        <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100" onClick={(event) => event.stopPropagation()} role="presentation"><DropdownMenu trigger={({ toggle }) => <IconButton label="Действия" size="sm" onClick={toggle}><MoreHorizontal className="h-4 w-4" /></IconButton>} items={items} /></div>
      </div>
      {task.description ? <p className="line-clamp-2 text-label text-muted-foreground">{task.description}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {/*
         * Only "в работе" and "отменена" get a mark here — "todo" and "done"
         * already read unambiguously from the checkbox above. This matters
         * most when the board is grouped by project or priority (not
         * status): those columns mix every status together, and without
         * this a todo and an in-progress task were pixel-identical.
         */}
        {task.status === "in_progress" ? <StatusMark status="running" label="в работе" /> : null}
        {canceled ? <StatusMark status="cancelled" label="отменена" /> : null}
        {task.projectTag && !hideProject ? <span style={projectColor(task.projectTag)} title={task.projectTag} className="block max-w-full truncate rounded-full border px-2 py-0.5 text-micro font-medium sm:max-w-[16rem]">{task.projectTag}</span> : null}
        {task.dueAt ? (
          <span
            className={cx("inline-flex items-center gap-1 text-micro", overdue ? "text-destructive" : "text-subtle-foreground")}
            title={overdue ? "Просрочено" : undefined}
          >
            {overdue ? <AlertCircle className="h-3 w-3" aria-hidden /> : <CalendarClock className="h-3 w-3" aria-hidden />}
            {overdue ? <span className="sr-only">Просрочено</span> : null}
            {shortDateTime(task.dueAt)}
          </span>
        ) : null}
        {task.recurrence && recurrence ? <recurrence.CardMark /> : null}
        {planning && subtasks && subtasks.total > 0 ? <planning.SubtaskBadge progress={subtasks} /> : null}
        {planning && task.blocked ? <planning.BlockedBadge /> : null}
        {assignee ? (
          <Tooltip label={`Исполнитель: ${assignee.name}`}>
            <AccountAvatar userId={assignee.userId} name={assignee.name} hasAvatar={assignee.hasAvatar} size={22} />
          </Tooltip>
        ) : null}
      </div>
      {/* Quick status moves appear over the card on hover/focus and reserve no height (the same moves are in the "⋯" menu). */}
      <div className="absolute bottom-2 right-3 z-10 hidden flex-wrap justify-end gap-1 rounded-lg bg-card/95 p-0.5 opacity-0 shadow-md shadow-black/30 transition-opacity group-hover:opacity-100 focus-within:opacity-100 sm:flex" onClick={(event) => event.stopPropagation()} role="presentation">
        {TASK_STATUS_ORDER.filter((status) => status !== task.status).map((status) => <button key={status} type="button" onClick={() => onMove(status)} className="rounded-md border border-border px-1.5 py-0.5 text-micro text-muted-foreground hover:bg-white/5 hover:text-foreground">→ {TASK_STATUS_LABEL[status]}</button>)}
      </div>
    </div>
  );
}
