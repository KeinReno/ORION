"use client";

import {
  useDeleteTask,
  useMilestones,
  useProjects,
  useTasks,
  useUpdateTask,
  useWorkspaceMembers
} from "@orion/core-react";
import type { Task, UpdateTaskInput } from "@orion/shared-types";
import { ConfirmDialog, EmptyState, PanelBody, PanelShell, Skeleton, useToast } from "@orion/ui";
import { ListTodo } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openPanel } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { parentOptions } from "../lib/task-structure";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useEnabledPlugins } from "../lib/use-enabled-plugins";
import { TaskDetail } from "./tasks/task-detail";

/**
 * One task as a panel of its own (dock tab or detached window): the same pane the
 * task lists show beside them, over the same API and cache — an edit here is seen
 * in the list and the other way round. Rights are those of the viewer at open time;
 * the saved panel id grants nothing.
 */
export function TaskDetailPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const taskId = params?.instanceId;
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const { isEnabled: isPluginEnabled } = useEnabledPlugins();
  const teamOn = isPluginEnabled("team");
  const { toast } = useToast();

  const { data: tasks, isLoading } = useTasks(workspaceId);
  const { data: projects } = useProjects(isEnabled("projects") ? workspaceId : undefined);
  const { data: milestones } = useMilestones(isEnabled("projects") ? workspaceId : undefined);
  const { data: members } = useWorkspaceMembers(teamOn ? workspaceId : undefined);
  const updateTask = useUpdateTask(workspaceId);
  const deleteTask = useDeleteTask(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = taskId ? (tasks ?? []).find((t) => t.id === taskId) ?? null : null;
  const title = task?.title;
  useEffect(() => {
    if (title) api?.setTitle(title);
  }, [api, title]);
  const parentChoices = useMemo(() => parentOptions(tasks ?? [], task?.id), [tasks, task?.id]);

  if (!taskId || (!isLoading && !task)) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState icon={ListTodo} title="Задача не найдена" description="Возможно, она удалена или недоступна." />
        </PanelBody>
      </PanelShell>
    );
  }
  if (!task) {
    return (
      <PanelShell>
        <PanelBody>
          <Skeleton className="h-64 w-full" />
        </PanelBody>
      </PanelShell>
    );
  }

  async function save(id: string, patch: UpdateTaskInput): Promise<Task> {
    return updateTask.mutateAsync({ taskId: id, input: patch });
  }

  return (
    <PanelShell>
      <TaskDetail
        key={task.id}
        task={task}
        workspaceId={workspaceId}
        projects={isEnabled("projects") ? (projects ?? []) : undefined}
        members={teamOn ? (members ?? []) : undefined}
        tasks={tasks ?? []}
        milestones={isEnabled("projects") ? (milestones ?? []) : undefined}
        parentOptions={parentChoices}
        timeOn={isEnabled("time")}
        compact={false}
        standalone
        onSave={save}
        onClose={() => api?.close?.()}
        onDelete={() => setConfirmDelete(true)}
        onOpenTask={(id) => openPanel(`task:${id}`)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить задачу?"
        description={`«${task.title}» — действие необратимо.`}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteTask.mutate(task.id, {
            onSuccess: () => {
              toast({ title: "Задача удалена" });
              api?.close?.();
            },
            onError: () => toast({ title: "Не удалось удалить задачу", tone: "danger" })
          });
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </PanelShell>
  );
}
