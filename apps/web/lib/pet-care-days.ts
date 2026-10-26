import { addPetDays, petPlural, type PetCareDayLog, type PetDayRecord, type PetDaySymptom, type UpsertPetCareDayDraft } from "@orion/shared-types";

/**
 * Помощники дневника самочувствия питомца (Pet Care): «местный» день, сетка месяца, возраст.
 * Дни везде — строки `ГГГГ-ММ-ДД`; «сегодня» берём из часов клиента, как у привычек (`habitLocalDayKey`).
 */

/** Местный календарный день клиента (не UTC): вечерняя отметка не должна уезжать на завтра. */
export function petLocalDayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export const PET_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

export interface PetGridCell {
  day: string;
  dayOfMonth: number;
  inMonth: boolean;
}

/** Сетка месяца 6×7, неделя с понедельника; `month` — 1..12. */
export function petMonthGrid(year: number, month: number): PetGridCell[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  // 1 января 1970 — четверг; считаем день недели через UTC-штамп, чтобы не зависеть от пояса.
  const weekday = (new Date(`${first}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const start = addPetDays(first, -weekday);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return Array.from({ length: 42 }, (_, index) => {
    const day = addPetDays(start, index);
    return { day, dayOfMonth: Number(day.slice(8, 10)), inMonth: day.startsWith(prefix) };
  });
}

/** Сдвиг месяца: `{2026, 12}` + 1 → `{2027, 1}`. */
export function shiftPetMonth(cursor: { year: number; month: number }, delta: number): { year: number; month: number } {
  const index = cursor.year * 12 + (cursor.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function petMonthLabel(cursor: { year: number; month: number }): string {
  return `${MONTH_NAMES[cursor.month - 1]} ${cursor.year}`;
}

const fullFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "short", timeZone: "UTC" });
const shortFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

export function formatPetDay(day: string): string {
  return fullFormat.format(new Date(`${day}T00:00:00.000Z`));
}

export function formatPetDayShort(day: string): string {
  return shortFormat.format(new Date(`${day}T00:00:00.000Z`));
}

/** «3 года 2 мес»; пусто, если дня рождения нет или он в будущем. */
export function petAgeLabel(birthday: string | null, today: string = petLocalDayKey()): string {
  if (!birthday) return "";
  const [by, bm, bd] = birthday.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty! - by!) * 12 + (tm! - bm!);
  if (td! < bd!) months -= 1;
  if (months < 0) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years > 0 ? `${years} ${petPlural(years, "год", "года", "лет")}` : "", rest > 0 ? `${rest} мес` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "меньше месяца";
}

/** DTO дня → запись для расчётов `@orion/shared-types` (статус в DTO уже итоговый). */
export function toPetDayRecord(day: PetCareDayLog): PetDayRecord {
  return {
    day: day.day,
    status: day.status,
    statusAuto: day.statusAuto,
    appetite: day.appetite,
    activity: day.activity,
    stool: day.stool,
    water: day.water,
    vomitingCount: day.vomitingCount,
    weightKg: day.weightKg,
    symptoms: day.symptoms
  };
}

/** Черновик дня в форме: все поля заполнены, симптомы — полной формы (с выраженностью и временем). */
export type PetDayDraft = Omit<Required<UpsertPetCareDayDraft>, "symptoms"> & { symptoms: PetDaySymptom[] };

/** Пустой день для формы: «авто», ничего не отмечено. */
export function emptyPetDayDraft(): PetDayDraft {
  return {
    status: "normal",
    statusAuto: true,
    appetite: "",
    activity: "",
    stool: "",
    stoolVisits: [],
    water: "",
    vomitingCount: 0,
    weightKg: null,
    temperature: null,
    meds: "",
    note: "",
    symptoms: []
  };
}

export function petDayToDraft(day: PetCareDayLog): PetDayDraft {
  return {
    status: day.status,
    statusAuto: day.statusAuto,
    appetite: day.appetite,
    activity: day.activity,
    stool: day.stool,
    stoolVisits: day.stoolVisits.map((visit) => ({ ...visit })),
    water: day.water,
    vomitingCount: day.vomitingCount,
    weightKg: day.weightKg,
    temperature: day.temperature,
    meds: day.meds,
    note: day.note,
    symptoms: day.symptoms.map((item) => ({ ...item, amount: item.amount ?? "normal" }))
  };
}

/** `"4,5"`/`"4.5"`/`""` → число или `null`; мусор тоже `null` (форма не должна молча сохранять 0). */
export function parseDecimalInput(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
