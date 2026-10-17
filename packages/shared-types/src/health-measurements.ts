import { z } from "zod";

/**
 * «Здоровье» → показатели (ADR-0012). У каждого вида одна фиксированная единица, поэтому значения разных дней
 * всегда сравнимы. «Норму» ORION не придумывает: подсвечивается только выход за ЛИЧНЫЙ диапазон, который задал
 * человек. Границы правдоподобия ниже защищают от опечаток («700 кг»), а не оценивают здоровье.
 */
export const HEALTH_MEASUREMENT_KINDS = ["weight", "blood_pressure", "pulse", "glucose", "temperature", "spo2", "height"] as const;
export const healthMeasurementKindSchema = z.enum(HEALTH_MEASUREMENT_KINDS);
export type HealthMeasurementKind = z.infer<typeof healthMeasurementKindSchema>;

export const HEALTH_MEASUREMENT_META: Record<HealthMeasurementKind, { label: string; unit: string; min: number; max: number; decimals: number }> = {
  weight: { label: "Вес", unit: "кг", min: 1, max: 500, decimals: 1 },
  blood_pressure: { label: "Давление", unit: "мм рт. ст.", min: 40, max: 300, decimals: 0 },
  pulse: { label: "Пульс", unit: "уд/мин", min: 20, max: 250, decimals: 0 },
  glucose: { label: "Глюкоза", unit: "ммоль/л", min: 0.5, max: 60, decimals: 1 },
  temperature: { label: "Температура", unit: "°C", min: 30, max: 45, decimals: 1 },
  spo2: { label: "Сатурация", unit: "%", min: 50, max: 100, decimals: 0 },
  height: { label: "Рост", unit: "см", min: 30, max: 250, decimals: 0 }
};

const DIASTOLIC_RANGE = { min: 20, max: 200 };

/** Текст ошибки, если значение выглядит как опечатка, иначе null. */
export function measurementProblem(kind: HealthMeasurementKind, value: number, value2: number | null): string | null {
  const meta = HEALTH_MEASUREMENT_META[kind];
  if (!Number.isFinite(value) || value < meta.min || value > meta.max) return `${meta.label}: значение вне возможного диапазона ${meta.min}–${meta.max} ${meta.unit}. Проверьте ввод.`;
  if (kind === "blood_pressure") {
    if (value2 === null) return "Давление: укажите нижнее значение.";
    if (!Number.isFinite(value2) || value2 < DIASTOLIC_RANGE.min || value2 > DIASTOLIC_RANGE.max) return `Нижнее давление вне возможного диапазона ${DIASTOLIC_RANGE.min}–${DIASTOLIC_RANGE.max}. Проверьте ввод.`;
    if (value2 >= value) return "Нижнее давление должно быть меньше верхнего.";
  } else if (value2 !== null) {
    return `${meta.label}: второе значение не используется.`;
  }
  return null;
}

export const healthMeasurementSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  kind: healthMeasurementKindSchema,
  value: z.number(),
  value2: z.number().nullable(),
  measuredAt: z.string(),
  context: z.string(),
  note: z.string(),
  createdAt: z.string()
});
export type HealthMeasurement = z.infer<typeof healthMeasurementSchema>;

export const createHealthMeasurementInputSchema = z
  .object({
    kind: healthMeasurementKindSchema,
    value: z.number(),
    value2: z.number().nullable().default(null),
    measuredAt: z.string().datetime().optional(),
    context: z.string().trim().max(120).default(""),
    note: z.string().max(1000).default("")
  })
  .superRefine((v, ctx) => {
    const problem = measurementProblem(v.kind, v.value, v.value2);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["value"] });
  });
export type CreateHealthMeasurementInput = z.infer<typeof createHealthMeasurementInputSchema>;

export const healthTargetSchema = z.object({
  subjectId: z.string(),
  kind: healthMeasurementKindSchema,
  min: z.number().nullable(),
  max: z.number().nullable()
});
export type HealthTarget = z.infer<typeof healthTargetSchema>;

export const putHealthTargetInputSchema = z
  .object({ min: z.number().nullable(), max: z.number().nullable() })
  .refine((v) => v.min === null || v.max === null || v.min <= v.max, { message: "Нижняя граница больше верхней", path: ["min"] });
export type PutHealthTargetInput = z.infer<typeof putHealthTargetInputSchema>;

// ------------------------------------------------------------ чистая логика

export type RangeState = "below" | "within" | "above" | "unset";

/** Где значение относительно личного диапазона; «не задан» — если нет ни одной границы. */
export function rangeState(value: number, target: { min: number | null; max: number | null } | null | undefined): RangeState {
  if (!target || (target.min === null && target.max === null)) return "unset";
  if (target.min !== null && value < target.min) return "below";
  if (target.max !== null && value > target.max) return "above";
  return "within";
}

export interface SeriesSummary {
  count: number;
  latest: HealthMeasurement | null;
  min: number | null;
  max: number | null;
  average: number | null;
  /** Последнее минус первое значение окна; null, если точек меньше двух. */
  change: number | null;
  outOfRange: number;
}

/** Сводка по уже отфильтрованному ряду одного вида (по основному значению; для давления — верхнему). */
export function summarizeSeries(points: HealthMeasurement[], target: { min: number | null; max: number | null } | null | undefined): SeriesSummary {
  if (points.length === 0) return { count: 0, latest: null, min: null, max: null, average: null, change: null, outOfRange: 0 };
  const sorted = [...points].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const values = sorted.map((p) => p.value);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    latest: sorted[sorted.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    average: Math.round((sum / values.length) * 100) / 100,
    change: sorted.length > 1 ? Math.round((values[values.length - 1] - values[0]) * 100) / 100 : null,
    outOfRange: values.filter((v) => ["below", "above"].includes(rangeState(v, target))).length
  };
}

/** «120/80» для давления, «72,4» для остальных (запятая — по-русски). */
export function formatMeasurement(m: Pick<HealthMeasurement, "kind" | "value" | "value2">): string {
  const meta = HEALTH_MEASUREMENT_META[m.kind];
  const fmt = (n: number): string => n.toFixed(meta.decimals).replace(".", ",");
  return m.kind === "blood_pressure" && m.value2 !== null ? `${fmt(m.value)}/${fmt(m.value2)}` : fmt(m.value);
}

/** CSV для врача: заголовок + строки по времени; разделитель `;`, десятичная запятая, кавычки экранируются. */
export function measurementsToCsv(rows: HealthMeasurement[]): string {
  const esc = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["Дата", "Показатель", "Значение", "Единица", "Условия", "Заметка"].join(";")];
  for (const m of [...rows].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))) {
    const meta = HEALTH_MEASUREMENT_META[m.kind];
    lines.push([m.measuredAt, meta.label, formatMeasurement(m), meta.unit, esc(m.context), esc(m.note)].join(";"));
  }
  return lines.join("\n");
}
