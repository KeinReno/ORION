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
import clsx from "clsx";
import type { MutableRefObject } from "react";
import type { MarkdownEditorApi } from "./markdown-editor";
import type { FormatCommand } from "./markdown-format";
import { IconButton } from "./primitives";

interface ToolbarItem {
  command: FormatCommand;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GROUPS: ToolbarItem[][] = [
  [
    { command: "h1", label: "Заголовок 1", icon: Heading1 },
    { command: "h2", label: "Заголовок 2", icon: Heading2 },
    { command: "h3", label: "Заголовок 3", icon: Heading3 }
  ],
  [
    { command: "bold", label: "Жирный", icon: Bold },
    { command: "italic", label: "Курсив", icon: Italic },
    { command: "strike", label: "Зачёркнутый", icon: Strikethrough },
    { command: "code", label: "Код в строке", icon: Code }
  ],
  [
    { command: "bullet", label: "Маркированный список", icon: List },
    { command: "ordered", label: "Нумерованный список", icon: ListOrdered },
    { command: "task", label: "Список задач", icon: ListChecks },
    { command: "quote", label: "Цитата", icon: Quote }
  ],
  [
    { command: "link", label: "Ссылка", icon: Link2 },
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
 *
 * ORION-06: a narrow vertical rail by default (pinned beside the editor, so
 * scrolling a long note never hides it — AC1). `orientation="horizontal"` is
 * the top row for a narrow detail column (project problems and ideas): it must
 * be allowed to shrink (`min-w-0`) or its buttons become the column's minimum
 * width and the editor text stops wrapping. `shortcutLabels` is the live,
 * rebind-aware tooltip text per command (`describeCombo` + the Shortcut Manager
 * override) — this component has no opinion on where that string comes from.
 */
export function MarkdownToolbar({
  apiRef,
  disabled,
  orientation = "vertical",
  shortcutLabels
}: {
  apiRef: MutableRefObject<MarkdownEditorApi | null>;
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  /** command → human-readable combo, e.g. "Ctrl+B"; omit a command to show no shortcut hint. */
  shortcutLabels?: Partial<Record<FormatCommand, string>>;
}): React.ReactElement {
  const vertical = orientation === "vertical";
  return (
    <div
      role="toolbar"
      aria-label="Форматирование"
      aria-orientation={orientation}
      className={clsx(
        "orion-scroll flex min-w-0 max-w-full items-center gap-0.5",
        vertical ? "flex-col overflow-y-auto py-1" : "overflow-x-auto border-b border-border pb-1.5"
      )}
    >
      {GROUPS.map((group, index) => (
        <div key={group[0]?.command} className={clsx("flex shrink-0 items-center gap-0.5", vertical && "flex-col")}>
          {index > 0 ? <span className={clsx("bg-border", vertical ? "my-1 h-px w-4" : "mx-1 h-4 w-px")} aria-hidden /> : null}
          {group.map((item) => {
            const shortcut = shortcutLabels?.[item.command];
            return (
              <IconButton
                key={item.command}
                type="button"
                size="sm"
                label={shortcut ? `${item.label} (${shortcut})` : item.label}
                title={shortcut ? `${item.label} · ${shortcut}` : item.label}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apiRef.current?.format(item.command)}
              >
                <item.icon className="h-4 w-4" />
              </IconButton>
            );
          })}
        </div>
      ))}
    </div>
  );
}
