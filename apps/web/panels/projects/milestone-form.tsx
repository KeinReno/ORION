"use client";

import type { Milestone, MilestoneStatus } from "@orion/shared-types";
import { Button, Input, Select, Textarea } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { fromDatetimeLocal, toDatetimeLocal } from "../../lib/format";

/** Create/edit form for one milestone — same split as `task-form.tsx`, rendered in a Modal by `gantt.tsx`. */

export const MILESTONE_STATUS_ORDER: MilestoneStatus[] = ["planned", "in_progress", "done"];
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: "Запланирована",
  in_progress: "В работе",
  done: "Готова"
};

export interface MilestoneFormValues {
  title: string;
  note: string;
  status: MilestoneStatus;
  startAt: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  dependencyIds: string[];
}

export function MilestoneForm({
  initial,
  dependencyOptions,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: Milestone;
  /** Other milestones of the same project — the milestone being edited is filtered out by the caller. */
  dependencyOptions: Milestone[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: MilestoneFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(initial?.status ?? "planned");
  const [startAt, setStartAt] = useState(toDatetimeLocal(initial?.startAt ?? null));
  const [dueAt, setDueAt] = useState(toDatetimeLocal(initial?.dueAt ?? null));
  const [estimatedHours, setEstimatedHours] = useState(
    initial?.estimatedMinutes !== null && initial?.estimatedMinutes !== undefined ? String(initial.estimatedMinutes / 60) : ""
  );
  const [dependencyIds, setDependencyIds] = useState<string[]>(initial?.dependencyIds ?? []);

  function toggleDependency(id: string, checked: boolean): void {
    setDependencyIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    const hours = estimatedHours.trim() ? Number(estimatedHours) : null;
    void onSubmit({
      title: title.trim(),
      note,
      status,
      startAt: fromDatetimeLocal(startAt),
      dueAt: fromDatetimeLocal(dueAt),
      estimatedMinutes: hours !== null && Number.isFinite(hours) ? Math.round(hours * 60) : null,
      dependencyIds
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Название вехи" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={200} />
      <Textarea placeholder="Заметка (необязательно)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Начало
          <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Срок
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Статус
          <Select value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)}>
            {MILESTONE_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {MILESTONE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          План, часы (необязательно)
          <Input inputMode="decimal" placeholder="Не оценено" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
        </label>
      </div>
      {dependencyOptions.length > 0 ? (
        <details className="rounded-lg border border-border bg-white/[0.02] px-3 py-2">
          <summary className="cursor-pointer text-2xs text-subtle-foreground">
            Зависит от {dependencyIds.length > 0 ? `· ${dependencyIds.length}` : ""}
          </summary>
          <div className="orion-scroll mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {dependencyOptions.map((milestone) => (
              <label key={milestone.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-current"
                  checked={dependencyIds.includes(milestone.id)}
                  onChange={(e) => toggleDependency(milestone.id, e.target.checked)}
                />
                <span className="truncate">{milestone.title}</span>
              </label>
            ))}
          </div>
        </details>
      ) : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
