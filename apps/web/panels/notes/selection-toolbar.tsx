"use client";

import type { FormatCommand } from "@orion/ui";
import { IconButton } from "@orion/ui";
import { Bold, Code, Italic, Link2, ListChecks } from "lucide-react";

export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * ORION-06 — "контекстное форматирование выделенного текста": a small floating bar near a text
 * selection, Medium/Notion-style, offering the most-reached-for commands plus "turn into a task"
 * without leaving the selection to find the (now off-screen, in a long note) side rail. Positioned
 * with the same viewport rect `MarkdownEditor.onSelectionChange` reports — no separate coordinate
 * math here. Clamped to the viewport so a selection near the top/edge doesn't push it off-screen.
 */
export function SelectionToolbar({
  rect,
  onFormat,
  onConvertToTask
}: {
  rect: SelectionRect;
  onFormat: (command: FormatCommand) => void;
  onConvertToTask: () => void;
}): React.ReactElement {
  const width = 176;
  const top = Math.max(8, rect.top - 44);
  const left = Math.min(Math.max(8, (rect.left + rect.right) / 2 - width / 2), window.innerWidth - width - 8);

  return (
    <div
      role="toolbar"
      aria-label="Форматирование выделенного"
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-elevated p-1 shadow-xl"
      style={{ top, left, width }}
      // Keep the editor's own selection/focus intact — a click here must act on it, not collapse it.
      onMouseDown={(event) => event.preventDefault()}
    >
      <IconButton label="Жирный" size="sm" onClick={() => onFormat("bold")}><Bold className="h-4 w-4" /></IconButton>
      <IconButton label="Курсив" size="sm" onClick={() => onFormat("italic")}><Italic className="h-4 w-4" /></IconButton>
      <IconButton label="Код в строке" size="sm" onClick={() => onFormat("code")}><Code className="h-4 w-4" /></IconButton>
      <IconButton label="Ссылка" size="sm" onClick={() => onFormat("link")}><Link2 className="h-4 w-4" /></IconButton>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <IconButton label="Выделенное — в задачу" size="sm" onClick={onConvertToTask}><ListChecks className="h-4 w-4" /></IconButton>
    </div>
  );
}
