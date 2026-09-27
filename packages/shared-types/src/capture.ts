/**
 * Quick capture: the same rule for ⌘⇧N, the dashboard field and any future
 * inbox shortcut. Default destination is the inbox (the start of
 * capture → process). `/task` and `/note` are explicit shortcuts, not the
 * default, so a thought is never silently typed as the wrong entity.
 *
 * Slack/Linear-style prefixes on top of that: `!` at the start makes a task
 * due today; `#tag` anywhere in the remaining text becomes `projectTag` and
 * is stripped from the title. `#tag` alone is not a destination — without
 * `!` or `/task` the thought still lands in the inbox.
 */
export type QuickCaptureResult =
  | { kind: "task"; title: string; dueToday?: boolean; projectTag?: string | null }
  | { kind: "note"; title: string }
  | { kind: "inbox"; title: string }
  | { kind: "error"; message: string };

/** First `#token` as its own word — `C#` and `foo#bar` stay in the title. */
const PROJECT_TAG = /(?:^|\s)#([^\s#]+)/;

function extractProjectTag(raw: string): { title: string; projectTag: string | null } {
  const match = raw.match(PROJECT_TAG);
  if (!match) return { title: raw.trim(), projectTag: null };
  const projectTag = match[1].slice(0, 60);
  const title = raw.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { title, projectTag };
}

function asTask(rawTitle: string, enabled: boolean, dueToday: boolean): QuickCaptureResult {
  if (!enabled) return { kind: "error", message: "Модуль «Задачи» выключен" };
  const { title, projectTag } = extractProjectTag(rawTitle);
  if (!title) return { kind: "error", message: "Укажите название задачи" };
  return {
    kind: "task",
    title,
    ...(dueToday ? { dueToday: true } : {}),
    ...(projectTag ? { projectTag } : {})
  };
}

export function resolveQuickCapture(
  text: string,
  enabled: { tasks: boolean; notes: boolean }
): QuickCaptureResult {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", message: "Пустой ввод" };

  if (/^\/(task|задача)$/i.test(trimmed)) {
    return { kind: "error", message: "Укажите название задачи" };
  }
  if (/^\/(note|заметка)$/i.test(trimmed)) {
    return { kind: "error", message: "Укажите название заметки" };
  }

  const taskMatch = trimmed.match(/^\/(task|задача)\s+(.+)/i);
  if (taskMatch) {
    return asTask(taskMatch[2], enabled.tasks, false);
  }

  const noteMatch = trimmed.match(/^\/(note|заметка)\s+(.+)/i);
  if (noteMatch) {
    if (!enabled.notes) return { kind: "error", message: "Модуль «Заметки» выключен" };
    const title = noteMatch[2].trim();
    if (!title) return { kind: "error", message: "Пустой ввод" };
    return { kind: "note", title };
  }

  if (trimmed.startsWith("!")) {
    return asTask(trimmed.slice(1), enabled.tasks, true);
  }

  return { kind: "inbox", title: trimmed };
}

export function quickCapturePlaceholder(enabled: { tasks: boolean; notes: boolean }): string {
  if (enabled.notes && enabled.tasks) {
    return "В инбокс. ! — сегодня, #тег — проект. /task или /note — сразу сущность";
  }
  if (enabled.tasks) return "В инбокс. ! — сегодня, #тег — проект. /task — сразу задача";
  if (enabled.notes) return "В инбокс. /note — сразу заметка";
  return "Мысль → инбокс";
}

/** Live hint under the dashboard field — empty input has no hint. */
export function quickCaptureHint(result: QuickCaptureResult): string | null {
  if (result.kind === "task") return result.dueToday ? "→ задача на сегодня" : "→ задача";
  if (result.kind === "note") return "→ заметка";
  if (result.kind === "inbox") return "→ инбокс";
  if (result.message === "Пустой ввод") return null;
  return result.message;
}
