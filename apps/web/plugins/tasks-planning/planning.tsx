"use client";

import { Input, Select, cx } from "@orion/ui";
import { ListTree, Lock } from "lucide-react";
import type { TaskPlanningApi } from "../../lib/extensions/contracts";
import { SubtaskList } from "./subtask-list";

/** The label style of the surrounding form: the detail pane's `Prop` has `min-w-0`, the create form's does not. */
function labelClass(variant: "detail" | "form"): string {
  return variant === "detail"
    ? "flex min-w-0 flex-col gap-1 text-label text-subtle-foreground"
    : "flex flex-col gap-1 text-label text-subtle-foreground";
}

/**
 * Plugin `tasks-planning`: subtasks (parent/child), «зависит от», planned start, estimate in hours and
 * the hand-made order inside a column. Each piece is placed by the host exactly where it always was
 * (the forms interleave these fields with the module's own), so the plugin hands over small
 * presentational parts rather than one block. Stored values, the «blocked» state computed by the
 * server and the order in `sortOrder` do not depend on it.
 */
export const taskPlanningApi: TaskPlanningApi = {
  StartAt({ variant, value, onChange }) {
    return (
      <label className={labelClass(variant)}>
        Начало (план)
        <Input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  },

  EstimatedHours({ variant, value, onChange }) {
    return (
      <label className={labelClass(variant)}>
        План, часы
        <Input inputMode="decimal" placeholder="Не оценено" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  },

  Parent({ variant, value, options, onChange }) {
    return (
      <label className={labelClass(variant)}>
        Родительская задача
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Нет</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </Select>
      </label>
    );
  },

  Dependencies({ variant, selected, options, onToggle }) {
    const list = (
      <div className={cx("orion-scroll max-h-40 space-y-1 overflow-y-auto pr-1", variant === "detail" ? "mt-1" : "mt-2")}>
        {options.map((other) => (
          <label key={other.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-current"
              checked={selected.includes(other.id)}
              onChange={(event) => onToggle(other.id, event.target.checked)}
            />
            <span className="truncate">{other.title}</span>
          </label>
        ))}
      </div>
    );
    const hint = <p className="mt-1 text-micro text-subtle-foreground">Пока зависимость не закрыта, задача помечается как заблокированная.</p>;
    if (variant === "detail") {
      return (
        <div className="mt-3">
          <p className="text-label text-subtle-foreground">Зависит от{selected.length > 0 ? ` · ${selected.length}` : ""}</p>
          {list}
          {hint}
        </div>
      );
    }
    return (
      <details className="rounded-lg border border-border bg-white/[0.02] px-3 py-2">
        <summary className="cursor-pointer text-micro text-subtle-foreground">Зависит от {selected.length > 0 ? `· ${selected.length}` : ""}</summary>
        {list}
        {hint}
      </details>
    );
  },

  SubtaskSection: SubtaskList,

  SubtaskBadge({ progress }) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-micro text-subtle-foreground"
        title={`Подзадачи: сделано ${progress.done} из ${progress.total}`}
      >
        <ListTree className="h-3 w-3" /> {progress.done}/{progress.total}
      </span>
    );
  },

  BlockedBadge() {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-micro text-warning"
        title="Заблокирована: есть незакрытые зависимости"
      >
        <Lock className="h-3 w-3" /> заблокирована
      </span>
    );
  }
};
