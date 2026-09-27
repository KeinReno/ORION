"use client";

import type { Habit } from "@orion/shared-types";
import { Button, CheckToggle, IconButton, cx } from "@orion/ui";
import { Archive, ArchiveRestore } from "lucide-react";
import { habitSwatchColor } from "./habit-form";
import { scheduleLabel, streakLabel } from "./week";

/**
 * The two row shapes of the habits panel: the daily checklist (a checkbox that
 * has to answer instantly — see `useToggleHabit`) and an archived row. Both are
 * dumb: the panel owns the data and the pending state.
 */

export function TodayRow({
  habit,
  checked,
  busy,
  onToggle,
  onEdit,
  onArchive
}: {
  habit: Habit;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 px-3 py-2.5">
      <CheckToggle
        checked={checked}
        onClick={onToggle}
        disabled={busy}
        label={checked ? `${habit.name}: снять отметку за сегодня` : `${habit.name}: отметить за сегодня`}
        className="mt-0.5"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            title="Изменить привычку"
            className={cx(
              "max-w-full truncate text-left text-sm outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60",
              !checked && new Date().getHours() >= 20 ? "text-warning" : "text-foreground"
            )}
          >
            {habit.name}
          </button>
          {/* The number is the server's `streak`; the words are its accessible name. */}
          {habit.streak > 0 ? (
            <span
              title={streakLabel(habit.streak)}
              className={
                habit.streak >= 7
                  ? "inline-flex items-center gap-0.5 rounded-full bg-accent px-2 py-0.5 text-micro font-medium text-accent-foreground"
                  : "inline-flex items-center gap-0.5 text-label text-muted-foreground"
              }
            >
              🔥 {habit.streak}
            </span>
          ) : null}
          {habit.color ? (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: habitSwatchColor(habit.color) }}
            />
          ) : null}
          {habit.weekdays.length > 0 ? (
            <span className="text-2xs text-subtle-foreground">{scheduleLabel(habit.weekdays)}</span>
          ) : null}
        </div>
        {habit.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{habit.note}</p> : null}
      </div>

      <IconButton label="Убрать в архив" size="sm" disabled={busy} onClick={onArchive}>
        <Archive className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

export function ArchiveRow({
  habit,
  busy,
  onRestore
}: {
  habit: Habit;
  busy: boolean;
  onRestore: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="max-w-full truncate text-sm text-muted-foreground">{habit.name}</span>
          <span className="text-2xs text-subtle-foreground">{scheduleLabel(habit.weekdays)}</span>
          {habit.streak > 0 ? <span className="text-2xs text-subtle-foreground">{streakLabel(habit.streak)}</span> : null}
        </div>
        {habit.note ? <p className="mt-1 line-clamp-2 text-xs text-subtle-foreground">{habit.note}</p> : null}
      </div>

      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRestore}>
        <ArchiveRestore className="h-3.5 w-3.5" /> Вернуть
      </Button>
    </div>
  );
}
