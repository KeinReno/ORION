"use client";

import type { Task } from "@orion/shared-types";
import { type MenuItem } from "@orion/ui";
import { createElement, useState, type ReactElement } from "react";
import { useSlotContributions } from "../../lib/extensions/slot";

/** Menu bridge for optional task extensions. The host owns the menu and the task; extensions own their dialog. */
export function useTaskContextActions(
  workspaceId: string | undefined,
  surface: "tasks" | "project-tasks",
  canManage = false
): { itemsForTask: (task: Task) => MenuItem[]; dialogs: ReactElement[] } {
  const contributions = useSlotContributions("tasks.context.actions");
  const [active, setActive] = useState<{ key: string; task: Task } | null>(null);

  function itemsForTask(task: Task): MenuItem[] {
    return contributions.flatMap((contribution) => {
      const meta = contribution.meta;
      if (!meta?.label || !meta.actionId) return [];
      const key = `${contribution.pluginId}:${meta.actionId}`;
      return [{ label: meta.label, onSelect: () => setActive({ key, task }) }];
    });
  }

  const dialogs = contributions.flatMap((contribution) => {
    const meta = contribution.meta;
    if (!meta?.label || !meta.actionId) return [];
    const key = `${contribution.pluginId}:${meta.actionId}`;
    if (!active) return [];
    return [createElement(contribution.component, {
      key,
      workspaceId,
      task: active.task,
      surface,
      canManage,
      open: active.key === key,
      onClose: () => setActive(null)
    })];
  });

  return { itemsForTask, dialogs };
}
