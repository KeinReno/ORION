"use client";

import { isTaskClosed, type Task } from "@orion/shared-types";
import { Badge, CheckToggle, cx, StrikeText, useContextMenu, type MenuItem } from "@orion/ui";
import { Pencil, UserRound } from "lucide-react";
import { shortDate } from "../../lib/format";
import { isTaskOverdue } from "../../lib/project-focus";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "../task-form";
import { useAgentRowMark } from "../../lib/agent-presence";
import { useState } from "react";
import { TaskAssignmentDialog, type TaskAssigneeOption } from "../tasks/task-assignment-dialog";
import { useTaskContextActions } from "../tasks/task-context-actions";

/**
 * One task as a row inside a project (overview «Горит» / «Дальше», the list view).
 * `onOpen` opens the task where the user is — inside the project — instead of
 * sending them to the general Tasks panel.
 */
export function TaskRow({
  task,
  workspaceId,
  canManageAgentAssignments = false,
  now,
  onToggle,
  onOpen,
  assignmentMembers,
  assignmentAvailable = false,
  onAssign
}: {
  task: Task;
  workspaceId: string | undefined;
  canManageAgentAssignments?: boolean;
  now: Date;
  onToggle: () => void;
  onOpen: () => void;
  assignmentMembers?: TaskAssigneeOption[];
  assignmentAvailable?: boolean;
  onAssign?: (assigneeId: string | null) => Promise<void>;
}): React.ReactElement {
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const closed = isTaskClosed(task.status);
  const overdue = isTaskOverdue(task, now);
  const agentMark = useAgentRowMark(task.id);
  const menuItems: (MenuItem | "separator")[] = [
    { label: "Открыть", icon: Pencil, onSelect: onOpen },
    ...(onAssign ? [{ label: "Исполнитель…", icon: UserRound, disabled: !assignmentAvailable, onSelect: () => setAssignmentOpen(true) }] : [])
  ];
  const contextActions = useTaskContextActions(workspaceId, "project-tasks", canManageAgentAssignments);
  const extensionItems = contextActions.itemsForTask(task);
  if (extensionItems.length > 0) menuItems.push("separator", ...extensionItems);
  const contextMenu = useContextMenu(() => menuItems);
  return (
    <>
    {contextActions.dialogs}
    <li
      draggable
      onContextMenu={contextMenu.onContextMenu}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-orion-task", task.id);
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cx("flex items-center gap-2 rounded-lg px-2 py-row transition-colors hover:bg-card-hover", agentMark.className)}
    >
      <CheckToggle
        checked={task.status === "done"}
        onClick={onToggle}
        label={task.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
        disabled={task.status === "canceled"}
        size="sm"
      />
      <button
        type="button"
        onClick={onOpen}
        title="Открыть задачу"
        className={cx(
          "min-w-0 flex-1 truncate text-left text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          closed ? "text-subtle-foreground" : "text-foreground hover:underline"
        )}
      >
        <StrikeText done={closed}>{task.title}</StrikeText>
      </button>
      {agentMark.tag}
      {task.status === "in_progress" || task.status === "backlog" || task.status === "canceled" ? (
        <Badge tone={task.status === "in_progress" ? "accent" : "neutral"}>{TASK_STATUS_LABEL[task.status]}</Badge>
      ) : null}
      {!closed && task.blocked ? <Badge tone="warning">Ждёт зависимость</Badge> : null}
      {!closed && task.priority === "high" ? (
        <Badge tone="warning" icon={false}>
          {TASK_PRIORITY_LABEL.high}
        </Badge>
      ) : null}
      {task.dueAt ? (
        <span className={cx("shrink-0 font-mono text-micro tabular-nums", overdue ? "text-destructive" : "text-subtle-foreground")}>
          {shortDate(task.dueAt)}
        </span>
      ) : null}
    </li>
    {onAssign && assignmentMembers ? (
      <TaskAssignmentDialog
        open={assignmentOpen}
        task={task}
        members={assignmentMembers}
        available={assignmentAvailable}
        onClose={() => setAssignmentOpen(false)}
        onAssign={onAssign}
      />
    ) : null}
    </>
  );
}
