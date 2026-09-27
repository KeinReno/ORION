"use client";

import clsx from "clsx";

export type AutosaveState = "saving" | "dirty" | "saved" | "error";

/**
 * One autosave indicator for every surface that writes on a debounce or
 * on-blur (Notes, project context note, document metadata). Panels own the
 * state machine; this only renders the three canonical phrases.
 *
 * New unsaved records skip autosave by design — pass `explicit` so the
 * primary Save button stays the obvious action instead of a quiet status.
 */
export function AutosaveStatus({
  state,
  explicit = false,
  className
}: {
  state: AutosaveState;
  explicit?: boolean;
  className?: string;
}): React.ReactElement {
  const text = explicit
    ? "Новая запись — сохраните явно"
    : state === "saving"
      ? "Сохраняю…"
      : state === "error"
        ? "Не удалось сохранить — черновик сохранён локально"
        : state === "dirty"
          ? "Есть несохранённые изменения"
          : "Всё сохранено";

  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx(
        "text-label text-subtle-foreground",
        state === "dirty" && !explicit && "text-warning",
        state === "error" && "text-destructive",
        className
      )}
    >
      {text}
    </span>
  );
}
