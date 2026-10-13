"use client";

import { useAttachToHome, useCreateTask, useRefreshHome, useSession, useTasks, useUpdateTask, useWorkspaceMembers } from "@orion/core-react";
import { isTaskClosed } from "@orion/shared-types";
import { CheckToggle, Select, cx, useToast } from "@orion/ui";
import { ListTodo, X } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { focusTask } from "../../lib/panel-bus";
import { useEnabledPlugins } from "../../lib/use-enabled-plugins";
import { EmptyLine, QuickAdd, SectionCard, type HomeSectionProps } from "./shared";

/**
 * Chores and errands of the home. A task made here is an ordinary task (it shows in «Задачи» too)
 * that points at this home; with the «Команда» plugin it can be handed to a family member.
 */
export function HomeTasks({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const { user } = useSession();
  const { isEnabled: isPluginEnabled } = useEnabledPlugins();
  const teamOn = isPluginEnabled("team");
  const { data: tasks } = useTasks(workspaceId);
  const { data: members } = useWorkspaceMembers(teamOn ? workspaceId : undefined);
  const createTask = useCreateTask(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const attach = useAttachToHome(workspaceId);
  const refresh = useRefreshHome(workspaceId);

  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);

  const myMemberId = (members ?? []).find((m) => m.userId === user?.id)?.id;
  const memberName = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  const mine = useMemo(() => new Set(overview.taskIds), [overview.taskIds]);
  const rows = useMemo(() => {
    const list = (tasks ?? []).filter((t) => mine.has(t.id) && (!onlyMine || t.assigneeId === myMemberId));
    return list.sort((a, b) => {
      const closed = Number(isTaskClosed(a.status)) - Number(isTaskClosed(b.status));
      if (closed !== 0) return closed;
      return (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9");
    });
  }, [tasks, mine, onlyMine, myMemberId]);
  const open = rows.filter((t) => !isTaskClosed(t.status)).length;

  async function add(title: string): Promise<void> {
    try {
      await createTask.mutateAsync({
        title,
        description: "",
        priority: "normal",
        homeId: home.id,
        ...(assignee ? { assigneeId: assignee } : {}),
        ...(due ? { dueAt: new Date(`${due}T12:00:00`).toISOString() } : {})
      });
      await refresh();
      setDue("");
    } catch (error) {
      toast({ title: "Не удалось добавить дело", description: describeError(error), tone: "danger" });
      throw error;
    }
  }

  return (
    <SectionCard title="Дела и поручения" icon={ListTodo} summary={open ? `открыто: ${open}` : undefined}>
      <QuickAdd
        placeholder="Новое дело, например «вызвать мастера»"
        busy={createTask.isPending}
        onAdd={add}
        extra={
          <>
            <input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Срок" className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-label" />
            {teamOn && (members ?? []).length > 1 ? (
              <Select aria-label="Кому поручить" value={assignee} onChange={(event) => setAssignee(event.target.value)} className="w-auto">
                <option value="">Никому</option>
                {(members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        }
      />
      {teamOn && myMemberId ? (
        <label className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
          <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} className="accent-accent" />
          Только мои поручения
        </label>
      ) : null}
      {rows.length === 0 ? (
        <EmptyLine>Дел по дому пока нет.</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {rows.map((task) => {
            const closed = isTaskClosed(task.status);
            return (
              <li key={task.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
                <CheckToggle
                  checked={task.status === "done"}
                  onClick={() => updateTask.mutate({ taskId: task.id, input: { status: task.status === "done" ? "todo" : "done" } }, { onSuccess: () => void refresh(), onError: (error) => toast({ title: "Не удалось обновить", description: describeError(error), tone: "danger" }) })}
                  label={task.status === "done" ? "Вернуть в работу" : "Выполнено"}
                  size="sm"
                />
                <button type="button" onClick={() => focusTask(task.id)} className={cx("min-w-0 flex-1 truncate text-left text-label hover:underline", closed && "text-subtle-foreground line-through")}>
                  {task.title}
                </button>
                {task.assigneeId && memberName.get(task.assigneeId) ? <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-2xs text-muted-foreground">{memberName.get(task.assigneeId)}</span> : null}
                {task.dueAt ? <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">{shortDate(task.dueAt)}</span> : null}
                <button
                  type="button"
                  aria-label="Убрать из дома"
                  title="Убрать из дома (задача останется в «Задачах»)"
                  onClick={() => attach.mutate({ homeId: home.id, input: { type: "task", id: task.id }, attach: false })}
                  className="rounded p-0.5 text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
