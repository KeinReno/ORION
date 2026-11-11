/**
 * Упоминания `@имя` в тексте комментария (задание 12.3).
 *
 * Разбор — чистая функция без БД: панель, сервер и тесты пользуются одним правилом. Резолв имени в
 * участника пространства живёт на сервере (`MentionsService`), здесь только текст.
 *
 * Формы:
 *  - `@Иван` — одно слово: буквы (латиница/кириллица), цифры, `_`, `.`, `-`, апостроф;
 *  - `@"Иван Петров"` — явные кавычки, если в имени есть пробелы;
 *  - `user@example.com` — не упоминание: `@` внутри слова игнорируется;
 *  - завершающая пунктуация (`@Иван,` `@Иван.` `(@Иван)`) в имя не входит.
 */
export const MENTION_MAX_NAME_LENGTH = 120;

const WORD_CHAR = /[\p{L}\p{N}_.'’-]/u;
const QUOTED_MENTION = /(^|[^\p{L}\p{N}_.'’-])@"([^"\n]{1,120})"/gu;
const PLAIN_MENTION = /(^|[^\p{L}\p{N}_.'’-])@([\p{L}\p{N}_.'’-]{1,120})/gu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»"']+$/u;

/** Имена, упомянутые в тексте, в порядке появления, без повторов (`Иван` и `иван` — одно имя). */
export function parseMentions(text: string): string[] {
  const found: Array<{ name: string; at: number }> = [];

  for (const match of text.matchAll(QUOTED_MENTION)) {
    const name = match[2]!.trim();
    if (name) found.push({ name, at: match.index ?? 0 });
  }

  // Quoted spans are blanked out before the plain pass so `@"Иван Петров"` is not also read as `@Иван`.
  const withoutQuoted = text.replace(QUOTED_MENTION, (whole) => " ".repeat(whole.length));
  for (const match of withoutQuoted.matchAll(PLAIN_MENTION)) {
    const name = match[2]!.replace(TRAILING_PUNCTUATION, "");
    if (name) found.push({ name, at: match.index ?? 0 });
  }

  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of found) {
    const key = entry.name.toLocaleLowerCase("ru");
    if (entry.name.length > MENTION_MAX_NAME_LENGTH || seen.has(key)) continue;
    seen.add(key);
    names.push(entry.name);
  }
  return names;
}

/** Есть ли в тексте хотя бы одно упоминание — дешёвая проверка для вызывающего кода. */
export function hasMentions(text: string): boolean {
  return parseMentions(text).length > 0;
}

/** `@имя` для отображения: имя с пробелами заключается в кавычки, чтобы его можно было распознать обратно. */
export function formatMention(name: string): string {
  const trimmed = name.trim();
  return WORD_CHAR.test(trimmed) && !/\s/.test(trimmed) ? `@${trimmed}` : `@"${trimmed}"`;
}
