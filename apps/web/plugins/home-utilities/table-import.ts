import type { ImportUtilityMonthsInput } from "@orion/shared-types";

const months = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function cells(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { result.push(value.trim()); value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("Незакрытая кавычка в таблице");
  result.push(value.trim());
  return result;
}

function amount(text: string, required: boolean): number | null {
  const normalized = text.replace(/[\s\u00a0]/g, "").replace(",", ".").replace(/₽|руб\.?/gi, "").trim();
  if (!normalized && !required) return null;
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(normalized)) throw new Error(`Неверная сумма «${text}»`);
  return Math.round(Number(normalized) * 100);
}

function period(text: string): string {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  const iso = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (iso) return value;
  const match = /^([а-яё]+)\s+(\d{4})\s*г?\.?$/.exec(value);
  const month = match ? months.indexOf(match[1]) : -1;
  if (month < 0) throw new Error(`Неверный период «${text}»`);
  return `${match![2]}-${String(month + 1).padStart(2, "0")}`;
}

/** Google Sheets paste (TSV) or semicolon CSV. Source totals remain available for reconciliation. */
export function parseUtilityTable(text: string): ImportUtilityMonthsInput["rows"] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Вставьте строку заголовков и хотя бы один месяц");
  const delimiter = lines[0].includes("\t") ? "\t" : ";";
  if (!lines[0].includes(delimiter)) throw new Error("Нужна таблица из Google Таблиц или CSV с разделителем «;»");
  const header = cells(lines[0], delimiter).map((value) => value.trim());
  const normalized = header.map((value) => value.toLowerCase().replace(/\s+/g, ""));
  const periodIndex = normalized.findIndex((value) => value === "период" || value === "месяц");
  const rentIndex = normalized.findIndex((value) => value === "квп" || value === "квартплата" || value === "квартирнаяплата");
  const utilityIndex = normalized.findIndex((value) => value === "итого");
  const grandIndex = normalized.findIndex((value) => value === "итоговая" || value === "общийитог");
  if (periodIndex < 0 || rentIndex < 0) throw new Error("Нужны колонки «Период» и «КВп» (квартирная плата)");
  const ignored = new Set([periodIndex, rentIndex, utilityIndex, grandIndex]);
  const suppliers = header.map((name, index) => ({ name, index })).filter(({ index }) => !ignored.has(index));
  if (!suppliers.length || suppliers.some(({ name }) => !name)) throw new Error("Укажите хотя бы одну компанию с названием");
  if (new Set(suppliers.map(({ name }) => name.toLowerCase())).size !== suppliers.length) throw new Error("Повторяются названия компаний");
  if (lines.length - 1 > 120) throw new Error("За один раз можно перенести до 120 месяцев");
  const rows = lines.slice(1).map((line, index) => {
    const values = cells(line, delimiter);
    if (values.length !== header.length) throw new Error(`Строка ${index + 2}: ожидается ${header.length} колонок, найдено ${values.length}`);
    try {
      return {
        period: period(values[periodIndex]), rentMinor: amount(values[rentIndex], true)!,
        charges: suppliers.map(({ name, index: column }) => ({ id: crypto.randomUUID(), name, amountMinor: amount(values[column], true)!, confirmed: false, note: "" })),
        importedUtilityMinor: utilityIndex < 0 ? null : amount(values[utilityIndex], false),
        importedGrandTotalMinor: grandIndex < 0 ? null : amount(values[grandIndex], false)
      };
    } catch (error) { throw new Error(`Строка ${index + 2}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  if (new Set(rows.map((row) => row.period)).size !== rows.length) throw new Error("В таблице повторяются месяцы");
  return rows;
}
