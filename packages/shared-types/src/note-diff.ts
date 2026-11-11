/**
 * Построчный diff для истории версий заметки (07 — Заметки 2.0, 7.1).
 *
 * Своего кода достаточно: сторонние diff-библиотеки не добавляем (см.
 * 00-README.md «Не ставить новые npm-зависимости»). Алгоритм — обычная
 * LCS-таблица по строкам с обрезкой общего префикса/суффикса, поэтому
 * типичная правка абзаца считается на десятках строк, а не на всём теле.
 *
 * Контракт намеренно бедный: фронту нужен список строк с типом и номерами,
 * чтобы показать «было/стало» без повторного парсинга Markdown.
 */

export type NoteDiffLineType = "equal" | "added" | "removed";

export interface NoteDiffLine {
  type: NoteDiffLineType;
  text: string;
  /** 1-based номер строки в старой версии; null для добавленных. */
  oldLine: number | null;
  /** 1-based номер строки в новой версии; null для удалённых. */
  newLine: number | null;
}

export interface NoteDiffResult {
  lines: NoteDiffLine[];
  added: number;
  removed: number;
}

/**
 * Предел размера LCS-таблицы. Тело заметки ограничено 20 000 символов
 * (createNoteInputSchema), но даже там «каждая строка изменилась» даёт
 * таблицу в миллионы ячеек — выше предела считаем середину сплошной
 * заменой, что для такого случая и есть правда.
 */
const MAX_LCS_CELLS = 2_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

/**
 * Сравнить два текста построчно. Возвращает ВСЕ строки (включая
 * совпадающие) в порядке новой версии, с удалёнными на своих местах —
 * ровно так это показывает история версий.
 */
export function diffNoteLines(before: string, after: string): NoteDiffResult {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);

  // Общий префикс/суффикс не участвует в LCS — иначе типичная правка в
  // середине длинной заметки строила бы таблицу по всему тексту.
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const middle = lcsDiff(oldMiddle, newMiddle, prefix + 1, prefix + 1);

  const lines: NoteDiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) {
    lines.push({ type: "equal", text: oldLines[index], oldLine: index + 1, newLine: index + 1 });
  }
  lines.push(...middle);
  for (let index = 0; index < suffix; index += 1) {
    const oldNumber = oldLines.length - suffix + index + 1;
    const newNumber = newLines.length - suffix + index + 1;
    lines.push({ type: "equal", text: oldLines[oldNumber - 1], oldLine: oldNumber, newLine: newNumber });
  }

  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "added") added += 1;
    else if (line.type === "removed") removed += 1;
  }
  return { lines, added, removed };
}

/** LCS по строкам середины. oldStart/newStart — 1-based номера первой строки середины. */
function lcsDiff(oldLines: string[], newLines: string[], oldStart: number, newStart: number): NoteDiffLine[] {
  const rows = oldLines.length;
  const columns = newLines.length;
  if (rows === 0) {
    return newLines.map((text, index) => ({ type: "added" as const, text, oldLine: null, newLine: newStart + index }));
  }
  if (columns === 0) {
    return oldLines.map((text, index) => ({ type: "removed" as const, text, oldLine: oldStart + index, newLine: null }));
  }
  if (rows * columns > MAX_LCS_CELLS) {
    return [
      ...oldLines.map((text, index) => ({ type: "removed" as const, text, oldLine: oldStart + index, newLine: null })),
      ...newLines.map((text, index) => ({ type: "added" as const, text, oldLine: null, newLine: newStart + index }))
    ];
  }

  // table[i][j] = LCS длина для oldLines[i:] и newLines[j:]; храним одной
  // плоской Int32Array — на предельном размере это 8 МБ вместо тысяч массивов.
  const width = columns + 1;
  const table = new Int32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const out: NoteDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: "equal", text: oldLines[i], oldLine: oldStart + i, newLine: newStart + j });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ type: "removed", text: oldLines[i], oldLine: oldStart + i, newLine: null });
      i += 1;
    } else {
      out.push({ type: "added", text: newLines[j], oldLine: null, newLine: newStart + j });
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ type: "removed", text: oldLines[i], oldLine: oldStart + i, newLine: null });
    i += 1;
  }
  while (j < columns) {
    out.push({ type: "added", text: newLines[j], oldLine: null, newLine: newStart + j });
    j += 1;
  }
  return out;
}
