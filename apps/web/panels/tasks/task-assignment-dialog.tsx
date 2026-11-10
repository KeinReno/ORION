"use client";

import type { Task } from "@orion/shared-types";
import { Button, Combobox, Modal } from "@orion/ui";
import { useEffect, useState } from "react";
import { describeError } from "../../lib/error-message";

export interface TaskAssigneeOption {
  id: string;
  name: string;
}

export function TaskAssignmentDialog({
  open,
  task,
  members,
  available,
  onClose,
  onAssign
}: {
  open: boolean;
  task: Task;
  members: TaskAssigneeOption[];
  available: boolean;
  onClose: () => void;
  onAssign: (assigneeId: string | null) => Promise<void>;
}): React.ReactElement {
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAssigneeId(task.assigneeId ?? "");
    setError(null);
  }, [open, task.id, task.assigneeId]);

  async function save(): Promise<void> {
    const nextAssigneeId = assigneeId || null;
    if (saving || nextAssigneeId === task.assigneeId) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAssign(nextAssigneeId);
      onClose();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Исполнитель задачи"
      description={`Изменится исполнитель только задачи «${task.title}». Назначение можно снять или заменить позже.`}
      size="sm"
      footer={(
        <div className="flex justify-end gap-2">
          <Button type="button" variant="subtle" disabled={saving} onClick={onClose}>Отмена</Button>
          <Button type="button" disabled={saving || !available} onClick={() => void save()}>{saving ? "Сохраняю…" : "Сохранить"}</Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <Combobox
          label="Исполнитель"
          value={assigneeId}
          onChange={setAssigneeId}
          items={[{ id: "", label: "Не назначен" }, ...members.map((member) => ({ id: member.id, label: member.name }))]}
          placeholder="Найти участника…"
        />
        {!available ? <p role="status" className="text-label text-subtle-foreground">Список участников пока недоступен. Назначение не изменено.</p> : null}
        {error ? <p role="alert" className="text-label text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}
