import type { ProjectLogType } from "@orion/shared-types";

/**
 * Чистая валидация «тип ↔ поля» для журнала проекта (задание 05). Вынесена из
 * сервиса, чтобы 422-карта ошибок проверялась unit-тестом без БД; сам сервис
 * отвечает только за поиск связанной записи (`confirmsEntryId`) в транзакции.
 */

export type ProjectLogFields = {
  rationale?: string;
  alternatives?: unknown;
  verificationDue?: string | null;
  confirmsEntryId?: string | null;
  severity?: string | null;
  resolution?: string;
  verdict?: string | null;
};

export type NormalisedProjectLogFields = {
  rationale: string;
  alternatives: Array<{ option: string; whyNot: string }>;
  verificationDue: Date | null;
  confirmsEntryId: string | null;
  severity: "low" | "medium" | "high" | null;
  resolution: string;
  verdict: "confirms" | "refutes" | null;
};

export type ProjectLogFieldErrors = Record<string, string>;

const TYPE_SPECIFIC_FIELDS = ["rationale", "alternatives", "verificationDue", "confirmsEntryId", "severity", "resolution", "verdict"] as const;

export function normaliseProjectLogFields(input: ProjectLogFields): NormalisedProjectLogFields {
  return {
    rationale: input.rationale ?? "",
    alternatives: readProjectLogAlternatives(input.alternatives),
    verificationDue: input.verificationDue ? new Date(input.verificationDue) : null,
    confirmsEntryId: input.confirmsEntryId ?? null,
    severity: (input.severity as NormalisedProjectLogFields["severity"]) ?? null,
    resolution: input.resolution ?? "",
    verdict: (input.verdict as NormalisedProjectLogFields["verdict"]) ?? null
  };
}

/**
 * Возвращает карту `поле → причина`. Пустая карта = запись валидна для типа.
 * Ссылка `confirmsEntryId` здесь только проверяется на «результату можно»;
 * существование и проект-target проверяет сервис в транзакции.
 */
export function validateProjectLogFields(type: ProjectLogType, fields: NormalisedProjectLogFields): ProjectLogFieldErrors {
  const errors: ProjectLogFieldErrors = {};
  const allowed = new Set<string>();
  if (type === "decision") {
    allowed.add("rationale");
    allowed.add("alternatives");
    if (!fields.rationale.trim()) errors.rationale = "Для решения обязательно обоснование (rationale)";
  } else if (type === "hypothesis") {
    allowed.add("verificationDue");
  } else if (type === "result") {
    allowed.add("confirmsEntryId");
    allowed.add("verdict");
    if (fields.verdict && !fields.confirmsEntryId) errors.verdict = "Вердикт указывается только вместе со ссылкой на запись";
  } else if (type === "incident") {
    allowed.add("severity");
    allowed.add("resolution");
    if (!fields.severity) errors.severity = "Для инцидента обязательна серьёзность (severity)";
  }
  for (const field of TYPE_SPECIFIC_FIELDS) {
    if (allowed.has(field)) continue;
    if (isEmptyField(field, fields)) continue;
    errors[field] = `${FIELD_LABEL[field]} не относится к типу «${TYPE_LABEL[type]}»`;
  }
  return errors;
}

export function readProjectLogAlternatives(value: unknown): Array<{ option: string; whyNot: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as { option?: unknown; whyNot?: unknown };
    return typeof row.option === "string" ? [{ option: row.option, whyNot: typeof row.whyNot === "string" ? row.whyNot : "" }] : [];
  });
}

function isEmptyField(field: (typeof TYPE_SPECIFIC_FIELDS)[number], fields: NormalisedProjectLogFields): boolean {
  const value = fields[field];
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === "";
}

const FIELD_LABEL: Record<(typeof TYPE_SPECIFIC_FIELDS)[number], string> = {
  rationale: "Обоснование",
  alternatives: "Альтернативы",
  verificationDue: "Дата проверки",
  confirmsEntryId: "Подтверждаемая запись",
  severity: "Серьёзность",
  resolution: "Разрешение",
  verdict: "Вердикт"
};

const TYPE_LABEL: Record<ProjectLogType, string> = {
  observation: "наблюдение",
  decision: "решение",
  hypothesis: "гипотеза",
  result: "результат",
  incident: "инцидент",
  change: "изменение"
};
