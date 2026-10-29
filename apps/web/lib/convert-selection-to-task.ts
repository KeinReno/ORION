/**
 * ORION-06 — "выделенное → задача": the pure half of the convert-to-task command. The first
 * non-empty line of the selection becomes the task title (every task-creation surface in this app
 * treats the title as a single line); anything after it becomes the description, verbatim. Kept
 * framework-free so the split itself is unit-tested without mounting CodeMirror or mocking mutations.
 */
const TITLE_MAX = 200;

export interface TaskFieldsFromSelection {
  title: string;
  description: string;
}

export function taskFieldsFromSelection(text: string): TaskFieldsFromSelection {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const firstNonEmpty = lines.findIndex((line) => line.trim() !== "");
  if (firstNonEmpty === -1) return { title: "", description: "" };
  const titleLine = lines[firstNonEmpty]!.trim();
  const description = lines.slice(firstNonEmpty + 1).join("\n").trim();
  const title = titleLine.length > TITLE_MAX ? `${titleLine.slice(0, TITLE_MAX - 1)}…` : titleLine;
  return { title, description };
}
