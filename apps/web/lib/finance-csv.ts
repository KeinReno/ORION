import type { FinanceImportRow } from "@orion/shared-types";

/**
 * Reading a bank/FinControl CSV into import rows — pure functions, tested in finance-csv.test.ts. Nothing here
 * guesses what the file does not say: a row without a readable date or amount is reported, never repaired; the
 * sign of an amount decides income/expense only when the user said "the sign is the direction"; money is parsed
 * from the text digit by digit (no floats), because 0.1 + 0.2 is not a bank balance.
 */

/** RFC 4180-style parser; the delimiter is detected from the first line (`,` `;` or tab). */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts] += 1;
  }
  const delimiter = (Object.keys(counts) as (keyof typeof counts)[]).reduce((best, key) => (counts[key] > counts[best] ? key : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value !== "") || rows.length === 0) rows.push(row);
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/**
 * "1 234,56" / "-500" / "+12.30" / "₽ 99" → minor units and the sign, or null when it is not a clean amount.
 * More than two fractional digits is refused (it would silently round money).
 */
export function parseAmount(raw: string): { minor: number; negative: boolean } | null {
  let text = raw.trim().replace(/[\s00a0]/g, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[₽$€£₸]|руб\.?|rub|usd|eur|kzt|byn/gi, "");
  if (text.startsWith("-") || text.startsWith("−") || text.startsWith("–")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  if (!/^\d+([.,]\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(/[.,]/);
  if (fraction.length > 2) return null;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 2_000_000_000) return null;
  return { minor, negative };
}

/** ISO (date or date-time), `dd.mm.yyyy`, `dd.mm.yy`, `dd/mm/yyyy`. A bare date means local noon of that day. */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  let date: Date | null = null;
  if (iso) date = localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), 12, 0);
  else if (dotted) {
    const year = dotted[3]!.length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    date = localDate(year, Number(dotted[2]), Number(dotted[1]), dotted[4] ? Number(dotted[4]) : 12, dotted[5] ? Number(dotted[5]) : 0);
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    const parsed = new Date(text.replace(" ", "T"));
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return date ? date.toISOString() : null;
}

function localDate(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // `new Date(2026, 1, 31)` rolls over to March: that is a wrong date, not a date.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export type ColumnRole = "date" | "amount" | "type" | "note" | "category" | "debit" | "credit";

const ROLE_NAMES: Record<ColumnRole, string[]> = {
  date: ["occurredat", "date", "дата", "дата операции", "дата платежа", "день"],
  amount: ["amount", "сумма", "сумма операции", "итого"],
  type: ["type", "тип", "вид операции", "вид"],
  note: ["note", "описание", "комментарий", "назначение", "назначение платежа", "memo", "details", "примечание"],
  category: ["categoryname", "category", "категория"],
  debit: ["расход", "списание", "debit", "withdrawal"],
  credit: ["приход", "поступление", "зачисление", "credit", "deposit"]
};

/** Header cells → the role each plays (first match wins; unknown columns are ignored). */
export function detectColumns(header: string[]): Partial<Record<ColumnRole, number>> {
  const found: Partial<Record<ColumnRole, number>> = {};
  header.forEach((cell, index) => {
    const name = cell.trim().toLowerCase();
    for (const role of Object.keys(ROLE_NAMES) as ColumnRole[]) {
      if (found[role] === undefined && ROLE_NAMES[role].includes(name)) found[role] = index;
    }
  });
  return found;
}

/** Does the first row look like a header (some cell is a known column name) rather than data? */
export function hasHeader(first: string[]): boolean {
  return Object.keys(detectColumns(first)).length >= 2;
}

export interface ImportOptions {
  /** What a positive/negative sign means when there is no type column: "sign" (− is expense), or a fixed type. */
  direction: "sign" | "expense" | "income";
}

export interface ParsedImportRow extends Omit<FinanceImportRow, "categoryId" | "ref"> {
  /** 1-based line in the file (the header counts), for messages. */
  line: number;
  /** The category name from the file; the UI maps it to a real category. */
  categoryName: string;
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  errors: { line: number; reason: string }[];
  /** Distinct category names found, in file order. */
  categoryNames: string[];
}

function typeFromText(raw: string): "income" | "expense" | null {
  const value = raw.trim().toLowerCase();
  if (["income", "доход", "приход", "+"].includes(value)) return "income";
  if (["expense", "расход", "списание", "-", "−"].includes(value)) return "expense";
  return null;
}

/** Turn the parsed table into rows plus per-line errors. Rows that cannot be read are errors, never guesses. */
export function buildImportRows(table: string[][], options: ImportOptions): ParsedImport {
  const header = table[0] && hasHeader(table[0]) ? table[0] : null;
  const columns = header ? detectColumns(header) : ({ date: 0, amount: 1, type: 2, note: 3, category: 4 } as Partial<Record<ColumnRole, number>>);
  const start = header ? 1 : 0;
  const rows: ParsedImportRow[] = [];
  const errors: ParsedImport["errors"] = [];
  const categoryNames: string[] = [];

  for (let i = start; i < table.length; i += 1) {
    const cells = table[i]!;
    const line = i + 1;
    const at = (role: ColumnRole): string => (columns[role] === undefined ? "" : (cells[columns[role]!] ?? "").trim());

    const occurredAt = parseImportDate(at("date"));
    if (!occurredAt) {
      errors.push({ line, reason: at("date") ? `Не удалось прочитать дату «${at("date")}»` : "Нет даты" });
      continue;
    }

    let minor: number | null = null;
    let type: "income" | "expense" | null = null;
    const debit = at("debit") ? parseAmount(at("debit")) : null;
    const credit = at("credit") ? parseAmount(at("credit")) : null;
    if (columns.debit !== undefined || columns.credit !== undefined) {
      if (debit && credit) {
        errors.push({ line, reason: "Заполнены и расход, и приход" });
        continue;
      }
      if (debit) {
        minor = debit.minor;
        type = "expense";
      } else if (credit) {
        minor = credit.minor;
        type = "income";
      }
    }
    if (minor === null) {
      const amount = parseAmount(at("amount"));
      if (!amount) {
        errors.push({ line, reason: at("amount") ? `Не удалось прочитать сумму «${at("amount")}»` : "Нет суммы" });
        continue;
      }
      minor = amount.minor;
      const typed = typeFromText(at("type"));
      if (typed) type = typed;
      else if (at("type")) {
        errors.push({ line, reason: `Неизвестный тип «${at("type")}» — нужен доход или расход` });
        continue;
      } else if (options.direction === "sign") type = amount.negative ? "expense" : "income";
      else type = options.direction;
    }

    const categoryName = at("category");
    if (categoryName && !categoryNames.includes(categoryName)) categoryNames.push(categoryName);
    rows.push({ line, occurredAt, type: type!, amount: minor, note: at("note").slice(0, 2000), tags: [], categoryName });
  }
  return { rows, errors, categoryNames };
}

/** Same-file-same-keys: a short stable hash of the normalised text, hex. Used inside each row's idempotency key. */
export async function fileFingerprint(text: string): Promise<string> {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const bytes = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `csv:<file hash>:<account>:<line>` — the same file into the same account twice yields the same keys. */
export function importRef(fingerprint: string, accountId: string, line: number): string {
  return `csv:${fingerprint}:${accountId}:${line}`;
}
