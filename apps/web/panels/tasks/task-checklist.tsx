"use client";

import { TASK_CHECKLIST_LIMIT, type TaskChecklistItem } from "@orion/shared-types";
import { CheckToggle, IconButton, Input } from "@orion/ui";
import { X } from "lucide-react";
import { useState } from "react";

/** Checklist inside a task: add a line, tick it, rename it, remove it. Blank lines stay local until they have a title. */
export function TaskChecklist({
  items,
  onChange
}: {
  items: TaskChecklistItem[];
  onChange: (items: TaskChecklistItem[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const done = items.filter((item) => item.done).length;
  const full = items.length >= TASK_CHECKLIST_LIMIT;

  function commitDraft(): void {
    const title = draft.trim();
    if (!title || full) return;
    onChange([...items, { id: crypto.randomUUID(), title, done: false }]);
    setDraft("");
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-label text-muted-foreground">Чек-лист{items.length > 0 ? ` · ${done}/${items.length}` : ""}</h3>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <CheckToggle
                checked={item.done}
                size="sm"
                label={item.done ? `Снять «${item.title}»` : `Отметить «${item.title}»`}
                onClick={() => onChange(items.map((row) => (row.id === item.id ? { ...row, done: !row.done } : row)))}
              />
              <Input
                value={item.title}
                aria-label={`Пункт «${item.title}»`}
                className="h-8 flex-1"
                maxLength={200}
                onChange={(event) => onChange(items.map((row) => (row.id === item.id ? { ...row, title: event.target.value } : row)))}
                onBlur={(event) => {
                  const title = event.target.value.trim();
                  if (!title) onChange(items.filter((row) => row.id !== item.id));
                  else if (title !== item.title) onChange(items.map((row) => (row.id === item.id ? { ...row, title } : row)));
                }}
              />
              <IconButton label={`Убрать «${item.title}»`} size="sm" tone="danger" onClick={() => onChange(items.filter((row) => row.id !== item.id))}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={draft}
          maxLength={200}
          disabled={full}
          placeholder="Пункт чек-листа"
          aria-label="Новый пункт чек-листа"
          className="h-8"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
        />
        <button type="button" disabled={full || draft.trim() === ""} onClick={commitDraft} className="shrink-0 text-label text-accent-text hover:underline disabled:opacity-40">
          Добавить
        </button>
      </div>
      <p className="text-micro text-subtle-foreground">При повторе задачи пункты снова станут неотмеченными.</p>
    </div>
  );
}
