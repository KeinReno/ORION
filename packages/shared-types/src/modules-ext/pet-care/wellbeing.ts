import { z } from "zod";

/**
 * Pet Care — дневник самочувствия (перенос идей MurHP: github.com/KeinReno/murhp).
 * День — `ГГГГ-ММ-ДД` без времени и пояса (колонка `@db.Date`); «сегодня» всегда присылает клиент (его местный день).
 * Статус дня, тревоги и статистика ВЫЧИСЛЯЮТСЯ здесь одной реализацией для сервера, панели и тестов, не хранятся.
 * Это наблюдения владельца, а не диагноз: тексты тревог направляют к ветеринару и ничего не лечат.
 */

export const petDayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата вида ГГГГ-ММ-ДД")
  .refine(isCalendarDay, "Такой даты нет в календаре");

// ---------- Справочники ----------

export const PET_DAY_STATUSES = ["good", "normal", "watch", "bad", "critical"] as const;
export const petDayStatusSchema = z.enum(PET_DAY_STATUSES);
export type PetDayStatus = z.infer<typeof petDayStatusSchema>;

export const PET_DAY_STATUS_META: Record<PetDayStatus, { label: string; short: string; color: string }> = {
  good: { label: "Отлично", short: "Отлично", color: "#22c55e" },
  normal: { label: "Нормально", short: "Норма", color: "#3b82f6" },
  watch: { label: "Есть нюансы", short: "Нюансы", color: "#eab308" },
  bad: { label: "Плохо", short: "Плохо", color: "#f97316" },
  critical: { label: "Очень плохо", short: "Критично", color: "#ef4444" }
};

export const PET_SEVERITIES = ["mild", "moderate", "severe", "critical"] as const;
export const petSeveritySchema = z.enum(PET_SEVERITIES);
export type PetSeverity = z.infer<typeof petSeveritySchema>;
export const PET_SEVERITY_LABELS: Record<PetSeverity, string> = { mild: "Легко", moderate: "Умеренно", severe: "Сильно", critical: "Критично" };
const SEVERITY_RANK: Record<PetSeverity, number> = { mild: 1, moderate: 2, severe: 3, critical: 4 };

export const PET_TIMES_OF_DAY = ["", "morning", "day", "evening", "night"] as const;
export const petTimeOfDaySchema = z.enum(PET_TIMES_OF_DAY);
export type PetTimeOfDay = z.infer<typeof petTimeOfDaySchema>;
export const PET_TIME_LABELS: Record<PetTimeOfDay, string> = { "": "—", morning: "Утро", day: "День", evening: "Вечер", night: "Ночь" };

export const PET_APPETITES = ["", "normal", "reduced", "picky", "refused"] as const;
export const petAppetiteSchema = z.enum(PET_APPETITES);
export type PetAppetite = z.infer<typeof petAppetiteSchema>;
export const PET_APPETITE_LABELS: Record<PetAppetite, string> = { "": "—", normal: "Как обычно", reduced: "Ест меньше", picky: "Избирательно", refused: "Отказ от еды" };

export const PET_ACTIVITIES = ["", "normal", "low", "very_low", "restless"] as const;
export const petActivitySchema = z.enum(PET_ACTIVITIES);
export type PetActivity = z.infer<typeof petActivitySchema>;
export const PET_ACTIVITY_LABELS: Record<PetActivity, string> = { "": "—", normal: "Обычная", low: "Сниженная", very_low: "Очень вялый", restless: "Беспокойный" };

export const PET_STOOLS = ["", "none", "normal", "soft", "liquid", "constipation", "blood", "mucus"] as const;
export const petStoolSchema = z.enum(PET_STOOLS);
export type PetStool = z.infer<typeof petStoolSchema>;
export const PET_STOOL_LABELS: Record<PetStool, string> = {
  "": "—",
  none: "Не было",
  normal: "Нормальный",
  soft: "Мягкий",
  liquid: "Жидкий",
  constipation: "Запор",
  blood: "С кровью",
  mucus: "Со слизью"
};

export const PET_WATERS = ["", "normal", "reduced", "none"] as const;
export const petWaterSchema = z.enum(PET_WATERS);
export type PetWater = z.infer<typeof petWaterSchema>;
export const PET_WATER_LABELS: Record<PetWater, string> = { "": "—", normal: "Пьёт обычно", reduced: "Пьёт мало", none: "Не пьёт" };

export type PetSymptomCategory = "gi" | "behavior" | "respiratory" | "urinary" | "general";

export interface PetSymptomDef {
  id: string;
  label: string;
  category: PetSymptomCategory;
  /** Тревожный симптом: сам по себе поднимает статус дня до «Очень плохо». */
  critical?: boolean;
}

export const PET_SYMPTOM_CATALOG: readonly PetSymptomDef[] = [
  { id: "vomiting", label: "Рвота", category: "gi" },
  { id: "vomiting_after_food", label: "Рвота после еды", category: "gi" },
  { id: "vomiting_night", label: "Рвота ночью", category: "gi" },
  { id: "diarrhea", label: "Жидкий стул", category: "gi" },
  { id: "soft_stool", label: "Мягкий стул", category: "gi" },
  { id: "constipation", label: "Запор", category: "gi" },
  { id: "blood_stool", label: "Кровь в стуле", category: "gi", critical: true },
  { id: "mucus_stool", label: "Слизь в стуле", category: "gi" },
  { id: "low_appetite", label: "Снижен аппетит", category: "gi" },
  { id: "no_appetite", label: "Отказ от еды", category: "gi", critical: true },
  { id: "no_water", label: "Отказ от воды", category: "gi", critical: true },
  { id: "lethargy", label: "Вялость", category: "behavior" },
  { id: "sleeping_all_day", label: "Спит весь день", category: "behavior" },
  { id: "hiding", label: "Прячется", category: "behavior" },
  { id: "restless", label: "Беспокойство", category: "behavior" },
  { id: "vocal", label: "Необычно мяукает", category: "behavior" },
  { id: "breathing", label: "Тяжёлое дыхание", category: "respiratory", critical: true },
  { id: "coughing", label: "Кашель", category: "respiratory" },
  { id: "sneezing", label: "Чихание", category: "respiratory" },
  { id: "eye_discharge", label: "Выделения из глаз", category: "respiratory" },
  { id: "nose_discharge", label: "Выделения из носа", category: "respiratory" },
  { id: "litter_often", label: "Часто в лоток", category: "urinary" },
  { id: "litter_little", label: "Мало мочи", category: "urinary", critical: true },
  { id: "no_urination", label: "Не мочится", category: "urinary", critical: true },
  { id: "urination_pain", label: "Больно мочиться", category: "urinary", critical: true },
  { id: "fever", label: "Жар / температура", category: "general" },
  { id: "weight_loss", label: "Потеря веса", category: "general" },
  { id: "other", label: "Другое", category: "general" }
];

export const PET_SYMPTOM_CATEGORY_ORDER: readonly PetSymptomCategory[] = ["gi", "behavior", "respiratory", "urinary", "general"];
export const PET_SYMPTOM_CATEGORY_LABELS: Record<PetSymptomCategory, string> = {
  gi: "ЖКТ и питание",
  behavior: "Поведение",
  respiratory: "Дыхание",
  urinary: "Мочеполовая",
  general: "Общее"
};

const SYMPTOM_BY_ID = new Map(PET_SYMPTOM_CATALOG.map((item) => [item.id, item]));

/** Неизвестный id (из старой копии или будущей версии) показываем как есть, а не роняем экран. */
export function petSymptomLabel(id: string): string {
  return SYMPTOM_BY_ID.get(id)?.label ?? id;
}

export const PET_EVENT_TYPES = ["food_change", "new_food", "medication", "vaccination", "antiparasitic", "vet_visit", "stress", "note"] as const;
export const petEventTypeSchema = z.enum(PET_EVENT_TYPES);
export type PetEventType = z.infer<typeof petEventTypeSchema>;
export const PET_EVENT_TYPE_LABELS: Record<PetEventType, string> = {
  food_change: "Смена корма",
  new_food: "Новый продукт",
  medication: "Начали лекарство",
  vaccination: "Вакцинация",
  antiparasitic: "Обработка от паразитов",
  vet_visit: "Визит к ветеринару",
  stress: "Стресс / гости / переезд",
  note: "Заметка"
};

// ---------- Схемы ----------

export const petDaySymptomSchema = z.object({
  id: z.string().trim().min(1).max(60),
  severity: petSeveritySchema,
  count: z.number().int().min(1).max(99),
  time: petTimeOfDaySchema,
  note: z.string().max(500)
});
export type PetDaySymptom = z.infer<typeof petDaySymptomSchema>;

/** Вход симптома: всё, кроме id, необязательно (дефолты — во входной схеме, не в ответной). */
export const petDaySymptomInputSchema = z.object({
  id: z.string().trim().min(1).max(60),
  severity: petSeveritySchema.default("moderate"),
  count: z.number().int().min(1).max(99).default(1),
  time: petTimeOfDaySchema.default(""),
  note: z.string().max(500).default("")
});

export const petCareDayLogSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  petId: z.string(),
  day: petDayKeySchema,
  /** Итоговое состояние: при `statusAuto` — выведенное из данных, иначе выбранное вручную. */
  status: petDayStatusSchema,
  statusAuto: z.boolean(),
  appetite: petAppetiteSchema,
  activity: petActivitySchema,
  stool: petStoolSchema,
  water: petWaterSchema,
  vomitingCount: z.number().int(),
  weightKg: z.number().nullable(),
  temperature: z.number().nullable(),
  meds: z.string(),
  note: z.string(),
  symptoms: z.array(petDaySymptomSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PetCareDayLog = z.infer<typeof petCareDayLogSchema>;

/** `PUT .../days/:day` заменяет запись дня целиком (как «Сохранить день» в MurHP). */
export const upsertPetCareDayInputSchema = z
  .object({
    status: petDayStatusSchema.default("normal"),
    statusAuto: z.boolean().default(true),
    appetite: petAppetiteSchema.default(""),
    activity: petActivitySchema.default(""),
    stool: petStoolSchema.default(""),
    water: petWaterSchema.default(""),
    vomitingCount: z.number().int().min(0).max(99).default(0),
    weightKg: z.number().min(0.01).max(200).nullable().default(null),
    temperature: z.number().min(30).max(45).nullable().default(null),
    meds: z.string().max(1000).default(""),
    note: z.string().max(4000).default(""),
    symptoms: z.array(petDaySymptomInputSchema).max(40).default([])
  })
  .refine((value) => new Set(value.symptoms.map((item) => item.id)).size === value.symptoms.length, {
    message: "Симптом можно отметить за день только один раз",
    path: ["symptoms"]
  });
export type UpsertPetCareDayInput = z.infer<typeof upsertPetCareDayInputSchema>;
/** Форма до применения дефолтов — то, что собирает форма на клиенте. */
export type UpsertPetCareDayDraft = z.input<typeof upsertPetCareDayInputSchema>;

/** Окно дней: границы включительно, не больше `PET_DAYS_MAX_RANGE` суток; без параметров — последние 90 дней (по часам сервера). */
export const PET_DAYS_MAX_RANGE = 800;
export const petCareRangeQuerySchema = z
  .object({ from: petDayKeySchema.optional(), to: petDayKeySchema.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { message: "«с» не может быть позже «по»", path: ["from"] })
  .refine((value) => !value.from || !value.to || diffPetDays(value.to, value.from) < PET_DAYS_MAX_RANGE, {
    message: `Окно не больше ${PET_DAYS_MAX_RANGE} дней`,
    path: ["to"]
  });
export type PetCareRangeQuery = z.infer<typeof petCareRangeQuerySchema>;

export const petCareEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  petId: z.string(),
  day: petDayKeySchema,
  type: petEventTypeSchema,
  title: z.string(),
  note: z.string(),
  createdAt: z.string()
});
export type PetCareEvent = z.infer<typeof petCareEventSchema>;

export const createPetCareEventInputSchema = z.object({
  day: petDayKeySchema,
  type: petEventTypeSchema.default("note"),
  title: z.string().trim().max(200).default(""),
  note: z.string().max(2000).default("")
});
export type CreatePetCareEventInput = z.infer<typeof createPetCareEventInputSchema>;

// ---------- Работа с днями (чистые помощники) ----------

const DAY_MS = 86_400_000;

function dayStamp(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year!, (month ?? 1) - 1, date ?? 1);
}

/** Реальная дата календаря: 31 февраля и мусор не проходят (refine в zod 3 выполняется и после неудачного regex). */
function isCalendarDay(day: string): boolean {
  const stamp = dayStamp(day);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day;
}

/** Сдвиг календарного дня на `n` суток; арифметика в UTC, поэтому не зависит от пояса и перехода на летнее время. */
export function addPetDays(day: string, n: number): string {
  return new Date(dayStamp(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Сколько суток от `b` до `a` (положительно, если `a` позже). */
export function diffPetDays(a: string, b: string): number {
  return Math.round((dayStamp(a) - dayStamp(b)) / DAY_MS);
}

export function petPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Часть записи дня, нужная расчётам; подходит и DTO, и входу формы. */
export interface PetDayFacts {
  appetite: PetAppetite;
  activity: PetActivity;
  stool: PetStool;
  water: PetWater;
  vomitingCount: number;
  symptoms: ReadonlyArray<{ id: string; severity: PetSeverity }>;
}

export interface PetDayRecord extends PetDayFacts {
  day: string;
  status: PetDayStatus;
  statusAuto: boolean;
  weightKg: number | null;
}

/** Состояние дня по данным: критические сигналы → «Очень плохо», плохие → «Плохо», любые отметки → «Есть нюансы». */
export function computePetDayStatus(day: PetDayFacts): PetDayStatus {
  const { symptoms } = day;
  const maxSeverity = symptoms.reduce((max, item) => Math.max(max, SEVERITY_RANK[item.severity] ?? 0), 0);
  const moderateOrWorse = symptoms.filter((item) => (SEVERITY_RANK[item.severity] ?? 0) >= 2).length;
  const criticalSymptom = maxSeverity >= 4 || symptoms.some((item) => SYMPTOM_BY_ID.get(item.id)?.critical);

  if (
    criticalSymptom ||
    day.stool === "blood" ||
    day.vomitingCount >= 4 ||
    day.water === "none" ||
    (day.appetite === "refused" && day.activity === "very_low")
  ) {
    return "critical";
  }

  if (
    day.vomitingCount >= 2 ||
    day.stool === "liquid" ||
    day.appetite === "refused" ||
    day.activity === "very_low" ||
    maxSeverity >= 3 ||
    moderateOrWorse >= 2
  ) {
    return "bad";
  }

  if (
    day.vomitingCount === 1 ||
    day.stool === "soft" ||
    day.stool === "constipation" ||
    day.stool === "mucus" ||
    day.appetite === "reduced" ||
    day.appetite === "picky" ||
    day.activity === "low" ||
    day.activity === "restless" ||
    day.water === "reduced" ||
    symptoms.length > 0
  ) {
    return "watch";
  }

  const allClear =
    day.vomitingCount === 0 &&
    (day.appetite === "" || day.appetite === "normal") &&
    (day.activity === "" || day.activity === "normal") &&
    (day.stool === "" || day.stool === "none" || day.stool === "normal") &&
    (day.water === "" || day.water === "normal");
  return allClear ? "good" : "normal";
}

export function effectivePetDayStatus(day: Pick<PetDayRecord, "status" | "statusAuto"> & PetDayFacts): PetDayStatus {
  return day.statusAuto ? computePetDayStatus(day) : day.status;
}

export interface PetAlert {
  level: "warn" | "danger";
  title: string;
  detail: string;
}

const hasSymptom = (day: PetDayFacts, id: string): boolean => day.symptoms.some((item) => item.id === id);

/**
 * Нейтральные «обратите внимание» по последним дням (без диагнозов). `days` — в любом порядке, `today` — местный день клиента.
 * Серия не обрывается из-за того, что сегодняшний день ещё не заполнен; любая другая дыра её обрывает.
 */
export function computePetAlerts(days: readonly PetDayRecord[], today: string): PetAlert[] {
  const byDay = new Map(days.map((item) => [item.day, item]));
  const alerts: PetAlert[] = [];

  const streak = (predicate: (item: PetDayRecord) => boolean): number => {
    let count = 0;
    for (let i = 0; i < 30; i += 1) {
      const item = byDay.get(addPetDays(today, -i));
      if (item && predicate(item)) count += 1;
      else if (i === 0 && !item) continue;
      else break;
    }
    return count;
  };
  const daysWord = (n: number): string => petPlural(n, "день", "дня", "дней");

  const vomiting = streak((item) => item.vomitingCount >= 1 || hasSymptom(item, "vomiting"));
  if (vomiting >= 3) {
    alerts.push({ level: "danger", title: `Рвота ${vomiting} ${daysWord(vomiting)} подряд`, detail: "Повторяющаяся рвота — повод показать питомца ветеринару." });
  }
  const loose = streak((item) => item.stool === "liquid" || hasSymptom(item, "diarrhea"));
  if (loose >= 3) {
    alerts.push({ level: "danger", title: `Жидкий стул ${loose} ${daysWord(loose)} подряд`, detail: "Длительная диарея опасна обезвоживанием." });
  }
  const noFood = streak((item) => item.appetite === "refused" || hasSymptom(item, "no_appetite"));
  if (noFood >= 2) {
    alerts.push({ level: "danger", title: `Отказ от еды ${noFood} ${daysWord(noFood)}`, detail: "Питомец не ест дольше суток — это может быть опасно." });
  }
  const lethargy = streak((item) => item.activity === "very_low" || hasSymptom(item, "lethargy") || hasSymptom(item, "sleeping_all_day"));
  if (lethargy >= 3) {
    alerts.push({ level: "warn", title: `Вялость ${lethargy} ${daysWord(lethargy)} подряд`, detail: "Стойкое снижение активности стоит обсудить с врачом." });
  }

  const pushOnce = (alert: PetAlert): void => {
    if (!alerts.some((item) => item.title === alert.title)) alerts.push(alert);
  };
  for (let i = 0; i < 7; i += 1) {
    const item = byDay.get(addPetDays(today, -i));
    if (!item) continue;
    if (item.stool === "blood" || hasSymptom(item, "blood_stool")) {
      pushOnce({ level: "danger", title: "Кровь в стуле", detail: `Отмечено ${item.day}. Рекомендуется обратиться к ветеринару.` });
    }
    if (item.water === "none" || hasSymptom(item, "no_urination") || hasSymptom(item, "litter_little")) {
      pushOnce({ level: "danger", title: "Проблемы с мочеиспусканием / питьём", detail: `Отмечено ${item.day}. Может требовать срочной помощи.` });
    }
    if (item.symptoms.filter((symptom) => SYMPTOM_BY_ID.get(symptom.id)?.critical).length >= 2) {
      pushOnce({ level: "danger", title: "Несколько критических симптомов за день", detail: `${item.day}. Сохраните отчёт и свяжитесь с ветеринаром.` });
    }
  }

  const weights = days.filter((item) => item.weightKg != null && item.day >= addPetDays(today, -30)).sort((a, b) => a.day.localeCompare(b.day));
  if (weights.length >= 2) {
    const first = weights[0]!;
    const last = weights[weights.length - 1]!;
    if (first.weightKg! > 0 && (first.weightKg! - last.weightKg!) / first.weightKg! >= 0.05) {
      alerts.push({
        level: "warn",
        title: "Снижение веса больше 5%",
        detail: `С ${first.day} (${first.weightKg} кг) по ${last.day} (${last.weightKg} кг).`
      });
    }
  }
  return alerts;
}

export interface PetStats {
  totalDays: number;
  loggedDays: number;
  byStatus: Record<PetDayStatus, number>;
  badOrWorse: number;
  vomitingEpisodes: number;
  vomitingDays: number;
  looseStoolDays: number;
  lethargyDays: number;
  longestBadStreak: number;
  weightFirst: number | null;
  weightLast: number | null;
  symptomFreq: Array<{ id: string; label: string; count: number }>;
}

/** Сводка за период `from..to` (включительно) по уже отобранным дням. */
export function computePetStats(days: readonly PetDayRecord[], from: string, to: string): PetStats {
  const byStatus: Record<PetDayStatus, number> = { good: 0, normal: 0, watch: 0, bad: 0, critical: 0 };
  const symptomCounts = new Map<string, number>();
  let vomitingEpisodes = 0;
  let vomitingDays = 0;
  let looseStoolDays = 0;
  let lethargyDays = 0;
  let longestBadStreak = 0;
  let currentBadStreak = 0;

  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  for (const item of sorted) {
    const status = effectivePetDayStatus(item);
    byStatus[status] += 1;
    if (item.vomitingCount > 0) {
      vomitingDays += 1;
      vomitingEpisodes += item.vomitingCount;
    }
    if (item.stool === "liquid") looseStoolDays += 1;
    if (item.activity === "very_low" || item.activity === "low") lethargyDays += 1;
    for (const symptom of item.symptoms) symptomCounts.set(symptom.id, (symptomCounts.get(symptom.id) ?? 0) + 1);
    if (status === "bad" || status === "critical") {
      currentBadStreak += 1;
      longestBadStreak = Math.max(longestBadStreak, currentBadStreak);
    } else {
      currentBadStreak = 0;
    }
  }

  const weighed = sorted.filter((item) => item.weightKg != null);
  return {
    totalDays: Math.max(0, diffPetDays(to, from) + 1),
    loggedDays: sorted.length,
    byStatus,
    badOrWorse: byStatus.bad + byStatus.critical,
    vomitingEpisodes,
    vomitingDays,
    looseStoolDays,
    lethargyDays,
    longestBadStreak,
    weightFirst: weighed[0]?.weightKg ?? null,
    weightLast: weighed[weighed.length - 1]?.weightKg ?? null,
    symptomFreq: [...symptomCounts.entries()]
      .map(([id, count]) => ({ id, label: petSymptomLabel(id), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
  };
}

// ---------- Импорт резервной копии MurHP ----------

/** Копия MurHP целиком: ORION разбирает её сам (`parseMurhpBackup`), поэтому строки дней и событий здесь намеренно не типизированы. */
export const importMurhpInputSchema = z.object({
  backup: z
    .object({
      app: z.literal("murhp", { message: "Это не резервная копия MurHP" }),
      version: z.number().optional(),
      exportedAt: z.string().optional(),
      cat: z.unknown().optional(),
      days: z.array(z.unknown()).max(5000),
      events: z.array(z.unknown()).max(5000).default([])
    })
    .passthrough(),
  /** `false` — день, уже записанный в ORION, не трогаем; `true` — заменяем данными из копии. */
  overwrite: z.boolean().default(false)
});
export type ImportMurhpInput = z.infer<typeof importMurhpInputSchema>;
export type ImportMurhpDraft = z.input<typeof importMurhpInputSchema>;

export const importMurhpResultSchema = z.object({
  daysCreated: z.number().int(),
  daysUpdated: z.number().int(),
  daysSkipped: z.number().int(),
  eventsCreated: z.number().int(),
  eventsSkipped: z.number().int(),
  /** Строки копии, которые не удалось прочитать (битая дата и т.п.). */
  invalidRows: z.number().int(),
  profileFilled: z.array(z.string())
});
export type ImportMurhpResult = z.infer<typeof importMurhpResultSchema>;

export interface MurhpProfile {
  name: string;
  birthdate: string;
  breed: string;
  weightKg: number | null;
  vetContact: string;
  chronic: string;
  allergies: string;
  notes: string;
}

export interface ParsedMurhpBackup {
  profile: MurhpProfile | null;
  days: Array<{ day: string; input: UpsertPetCareDayInput }>;
  events: CreatePetCareEventInput[];
  invalidRows: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const asText = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const asNumber = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
/** Значение справочника из копии; чужое значение превращаем в пустое, а не отбрасываем день. */
const asChoice = <T extends string>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
};
/** `yyyy-mm-dd` и это реальная дата (31 февраля не пройдёт). */
const isRealDay = (value: unknown): value is string => typeof value === "string" && petDayKeySchema.safeParse(value).success;

/**
 * Разбор копии MurHP (`exportBackup`): терпимо к пустым и незнакомым значениям, но день с нереальной датой пропускается
 * и считается в `invalidRows`. Повторные дни с одной датой — побеждает последний (как перезапись в MurHP).
 */
export function parseMurhpBackup(backup: { days: unknown[]; events: unknown[]; cat?: unknown }): ParsedMurhpBackup {
  let invalidRows = 0;
  const days = new Map<string, UpsertPetCareDayInput>();

  for (const raw of backup.days) {
    const row = asRecord(raw);
    if (!row || !isRealDay(row.date)) {
      invalidRows += 1;
      continue;
    }
    const symptoms: UpsertPetCareDayInput["symptoms"] = [];
    for (const rawSymptom of Array.isArray(row.symptoms) ? row.symptoms : []) {
      const symptom = asRecord(rawSymptom);
      const id = typeof symptom?.id === "string" ? symptom.id.trim().slice(0, 60) : "";
      if (!symptom || id === "" || symptoms.some((item) => item.id === id)) continue;
      symptoms.push({
        id,
        severity: asChoice(petSeveritySchema, symptom.severity, "moderate"),
        count: Math.min(99, Math.max(1, Math.trunc(asNumber(symptom.count, 1, 99) ?? 1))),
        time: asChoice(petTimeOfDaySchema, symptom.time, ""),
        note: asText(symptom.note, 500)
      });
    }
    days.set(row.date, {
      status: asChoice(petDayStatusSchema, row.status, "normal"),
      statusAuto: row.statusAuto !== false,
      appetite: asChoice(petAppetiteSchema, row.appetite, ""),
      activity: asChoice(petActivitySchema, row.activity, ""),
      stool: asChoice(petStoolSchema, row.stool, ""),
      water: asChoice(petWaterSchema, row.water, ""),
      vomitingCount: Math.trunc(asNumber(row.vomitingCount, 0, 99) ?? 0),
      weightKg: asNumber(row.weightKg, 0.01, 200),
      temperature: asNumber(row.temperature, 30, 45),
      meds: asText(row.meds, 1000),
      note: asText(row.note, 4000),
      symptoms
    });
  }

  const events: CreatePetCareEventInput[] = [];
  for (const raw of backup.events) {
    const row = asRecord(raw);
    if (!row || !isRealDay(row.date)) {
      invalidRows += 1;
      continue;
    }
    events.push({
      day: row.date,
      type: asChoice(petEventTypeSchema, row.type, "note"),
      title: asText(row.title, 200).trim(),
      note: asText(row.note, 2000)
    });
  }

  const cat = asRecord(backup.cat);
  const profile: MurhpProfile | null = cat
    ? {
        name: asText(cat.name, 120).trim(),
        birthdate: isRealDay(cat.birthdate) ? cat.birthdate : "",
        breed: asText(cat.breed, 120).trim(),
        weightKg: asNumber(cat.weightKg, 0.01, 200),
        vetContact: asText(cat.vetContact, 500).trim(),
        chronic: asText(cat.chronic, 1000).trim(),
        allergies: asText(cat.allergies, 1000).trim(),
        notes: asText(cat.notes, 4000).trim()
      }
    : null;

  return { profile, days: [...days.entries()].map(([day, input]) => ({ day, input })), events, invalidRows };
}
