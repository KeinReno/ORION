"use client";

import clsx from "clsx";
import { SaveGlyph } from "./save-glyph";

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
  errorText = "Не удалось сохранить — черновик сохранён локально",
  className
}: {
  state: AutosaveState;
  explicit?: boolean;
  /** Editors without durable local drafts must describe their actual recovery behavior. */
  errorText?: string;
  className?: string;
}): React.ReactElement {
  const text = explicit
    ? "Новая запись — сохраните явно"
    : state === "saving"
      ? "Сохраняю…"
      : state === "error"
        ? errorText
        : state === "dirty"
          ? "Есть несохранённые изменения"
          : "Всё сохранено";

  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx(
        "inline-flex items-center gap-1.5 text-label text-subtle-foreground",
        state === "dirty" && !explicit && "text-warning",
        state === "error" && "text-destructive",
        className
      )}
    >
      {!explicit && state !== "dirty" ? <SaveGlyph state={state} /> : null}
      {text}
    </span>
  );
}
