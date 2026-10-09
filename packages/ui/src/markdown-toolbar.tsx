"use client";

import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough
} from "lucide-react";
import type { MutableRefObject } from "react";
import type { MarkdownEditorApi } from "./markdown-editor";
import type { FormatCommand } from "./markdown-format";
import { IconButton } from "./primitives";

interface ToolbarItem {
  command: FormatCommand;
  label: string;
  /** Shown in the tooltip; the real binding lives in markdown-editor.tsx. */
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GROUPS: ToolbarItem[][] = [
  [
    { command: "h1", label: "Заголовок 1", icon: Heading1 },
    { command: "h2", label: "Заголовок 2", icon: Heading2 },
    { command: "h3", label: "Заголовок 3", icon: Heading3 }
  ],
  [
    { command: "bold", label: "Жирный", shortcut: "Ctrl+B", icon: Bold },
    { command: "italic", label: "Курсив", shortcut: "Ctrl+I", icon: Italic },
    { command: "strike", label: "Зачёркнутый", shortcut: "Ctrl+Shift+X", icon: Strikethrough },
    { command: "code", label: "Код в строке", shortcut: "Ctrl+E", icon: Code }
  ],
  [
    { command: "bullet", label: "Маркированный список", icon: List },
    { command: "ordered", label: "Нумерованный список", icon: ListOrdered },
    { command: "task", label: "Список задач", icon: ListChecks },
    { command: "quote", label: "Цитата", icon: Quote }
  ],
  [
    { command: "link", label: "Ссылка", shortcut: "Ctrl+Shift+K", icon: Link2 },
    { command: "codeblock", label: "Блок кода", icon: Code2 }
  ]
];

/**
 * Formatting buttons for `MarkdownEditor`. They only dispatch the same text
 * edits a person could type, so the note stays plain Markdown and undo/redo
 * treat each click as one step. Buttons keep the editor's focus and selection
 * (`mousedown` is cancelled) — otherwise the click would collapse the selection
 * the command is meant to act on. Every button is a real focusable control with
 * a text name, so the toolbar is reachable without a mouse too.
 */
export function MarkdownToolbar({
  apiRef,
  disabled
}: {
  apiRef: MutableRefObject<MarkdownEditorApi | null>;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="Форматирование"
      aria-orientation="horizontal"
      className="orion-scroll flex items-center gap-0.5 overflow-x-auto border-b border-border pb-1.5"
    >
      {GROUPS.map((group, index) => (
        <div key={group[0]?.command} className="flex shrink-0 items-center gap-0.5">
          {index > 0 ? <span className="mx-1 h-4 w-px bg-border" aria-hidden /> : null}
          {group.map((item) => (
            <IconButton
              key={item.command}
              type="button"
              size="sm"
              label={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              title={item.shortcut ? `${item.label} · ${item.shortcut}` : item.label}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apiRef.current?.format(item.command)}
            >
              <item.icon className="h-4 w-4" />
            </IconButton>
          ))}
        </div>
      ))}
    </div>
  );
}
