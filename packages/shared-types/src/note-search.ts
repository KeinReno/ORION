/**
 * Поиск внутри одной заметки (07 — Заметки 2.0, 7.3): позиции вхождений в
 * теле, чтобы фронт мог подсветить их без повторного парсинга Markdown.
 *
 * Смещения считаются в UTF-16 единицах — это индексы JavaScript-строки,
 * ровно то, чем оперирует String.prototype.slice на клиенте.
 */

export interface NoteTextMatch {
  /** Смещение начала вхождения в теле (включительно). */
  start: number;
  /** Смещение конца (исключительно). */
  end: number;
  /** Номер строки вхождения, 1-based. */
  line: number;
  /** Текст строки, где найдено вхождение (для превью результата). */
  text: string;
}

export interface NoteTextSearchResult {
  query: string;
  /** Сколько вхождений всего — может быть больше, чем matches.length. */
  total: number;
  matches: NoteTextMatch[];
  /** true = вхождений больше, чем поместилось в matches. */
  truncated: boolean;
}

/** Максимум позиций в ответе: подсветке хватает, а тело на 20 000 символов не раздувает ответ. */
export const NOTE_SEARCH_MATCH_LIMIT = 200;

/**
 * Все вхождения query в body без учёта регистра (вхождения не
 * перекрываются). Пустой запрос — пустой результат, а не «всё совпало».
 */
export function searchNoteText(body: string, query: string, limit = NOTE_SEARCH_MATCH_LIMIT): NoteTextSearchResult {
  const needle = query.trim();
  if (!needle || !body) return { query: needle, total: 0, matches: [], truncated: false };

  const haystack = body.toLowerCase();
  const lowered = needle.toLowerCase();
  const matches: NoteTextMatch[] = [];
  let total = 0;
  let from = 0;
  let line = 1;
  let lineStart = 0;

  while (from <= haystack.length) {
    const start = haystack.indexOf(lowered, from);
    if (start < 0) break;
    // Номер строки считаем инкрементально: до начала вхождения дошли — все
    // переводы строки до него уже посчитаны.
    for (let index = lineStart; index < start; index += 1) {
      if (body.charCodeAt(index) === 10) {
        line += 1;
        lineStart = index + 1;
      }
    }
    total += 1;
    if (matches.length < limit) {
      const end = start + needle.length;
      const lineEnd = body.indexOf("\n", lineStart);
      matches.push({
        start,
        end,
        line,
        text: body.slice(lineStart, lineEnd < 0 ? body.length : lineEnd)
      });
    }
    from = start + Math.max(1, needle.length);
  }

  return { query: needle, total, matches, truncated: total > matches.length };
}
