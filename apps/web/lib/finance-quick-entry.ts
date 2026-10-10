import { parseAmount } from "./finance-csv";

/**
 * «Быстрая запись»: `-500 хлеб #еда @вчера` → a DRAFT, never a transaction. The parser says what it understood
 * and what it did not (no sign → direction unknown, no date → none); the form that shows the draft makes the
 * person confirm account, direction and category before anything is written. Pure and tested (finance-quick-entry.test.ts).
 */

export interface QuickEntryDraft {
  amountMinor: number;
  /** "expense" for a leading «−», "income" for «+», null when the text did not say. */
  direction: "expense" | "income" | null;
  note: string;
  tags: string[];
  /** Local date the text asked for, or null. */
  date: Date | null;
  /** The last word of the note: a hint for matching a category by name — only a hint. */
  categoryHint: string;
}

export type QuickEntryResult = { ok: true; draft: QuickEntryDraft } | { ok: false; error: string };

const DAY_WORDS: Record<string, number> = { сегодня: 0, today: 0, вчера: -1, yesterday: -1, позавчера: -2 };

function localMidnightOffset(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12, 0, 0, 0);
}

/** `вчера`, `сегодня`, `дд.мм`, `дд.мм.гггг`, `гггг-мм-дд` → local noon; null when not a real date. */
export function parseDateToken(token: string, now: Date): Date | null {
  const word = token.toLowerCase();
  if (word in DAY_WORDS) return localMidnightOffset(now, DAY_WORDS[word]!);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(token);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dotted) {
    day = Number(dotted[1]);
    month = Number(dotted[2]);
    year = dotted[3] ? (dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3])) : now.getFullYear();
  } else return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function parseQuickEntry(input: string, now: Date = new Date()): QuickEntryResult {
  let rest = input.trim().replace(/\s+/g, " ");
  if (!rest) return { ok: false, error: "Введите сумму и описание, например: -500 хлеб #еда" };

  const tags: string[] = [];
  let date: Date | null = null;
  let dateError: string | null = null;
  rest = rest
    .replace(/(^| )#([^\s#@]+)/g, (_match, space: string, tag: string) => {
      if (!tags.includes(tag.slice(0, 40))) tags.push(tag.slice(0, 40));
      return space;
    })
    .replace(/(^| )@([^\s#@]+)/g, (_match, space: string, token: string) => {
      const parsed = parseDateToken(token, now);
      if (parsed) date = parsed;
      else dateError = `Не понял дату «@${token}»: нужно вчера, сегодня, дд.мм или гггг-мм-дд`;
      return space;
    })
    .trim();
  if (dateError) return { ok: false, error: dateError };

  const match = /(?:^| )([+\-−–]?)(\d+(?:[.,]\d{1,2})?)(?= |$)/.exec(rest);
  if (!match) return { ok: false, error: "Не нашёл сумму: напишите число, например -500" };
  const amount = parseAmount(match[2]!);
  if (!amount) return { ok: false, error: "Сумма должна быть больше нуля и не длиннее двух знаков после запятой" };

  const sign = match[1]!;
  const direction = sign === "+" ? "income" : sign ? "expense" : null;
  const start = match.index + (match[0].startsWith(" ") ? 1 : 0);
  const note = `${rest.slice(0, start)} ${rest.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
  const words = note.split(" ").filter(Boolean);
  return { ok: true, draft: { amountMinor: amount.minor, direction, note, tags, date, categoryHint: words.at(-1)?.toLowerCase() ?? "" } };
}
