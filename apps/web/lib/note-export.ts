import type { Note } from "@orion/shared-types";

/** Имя файла без символов, запрещённых в Windows/macOS/Linux. */
export function noteFileName(note: Pick<Note, "title">): string {
  const base = note.title
    // Filenames must strip ASCII control characters, including NUL and line breaks.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, "");
  return `${base || "Заметка"}.md`;
}

/** Markdown-файл заметки: YAML-шапка (теги, даты) + тело — открывается в Obsidian и любом редакторе. */
export function noteToMarkdown(note: Note): string {
  const q = (s: string) => JSON.stringify(s);
  const head: string[] = [`title: ${q(note.title)}`];
  if (note.summary) head.push(`summary: ${q(note.summary)}`);
  if (note.tags.length > 0) head.push(`tags: [${note.tags.map(q).join(", ")}]`);
  head.push(`created: ${note.createdAt}`, `updated: ${note.editedAt ?? note.updatedAt}`);
  return `---\n${head.join("\n")}\n---\n\n${note.body}\n`;
}

/** Скачивает заметку как .md-файл. */
export function downloadNote(note: Note): void {
  const blob = new Blob([noteToMarkdown(note)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = noteFileName(note);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Копирует тело заметки как Markdown в буфер обмена (для вставки в другие приложения). */
export async function copyNoteMarkdown(note: Note): Promise<void> {
  await navigator.clipboard.writeText(`# ${note.title}\n\n${note.body}\n`);
}
