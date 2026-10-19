import { z } from "zod";

/**
 * G11 — состояние данных компонента: объявленные в манифесте миграции против того, что реально применено в БД
 * (`_prisma_migrations`). Единая цепочка Prisma остаётся; здесь только проверка совместимости «код ↔ база», которую
 * раньше никто не делал: модуль с неприменённой миграцией падал на первом запросе к его таблице.
 * Схема ответа без `.default(...)`.
 */
export const componentDataStateSchema = z.enum(["ok", "pending", "failed", "unknown"]);
export type ComponentDataState = z.infer<typeof componentDataStateSchema>;

export const componentDataStatusSchema = z.object({
  componentId: z.string(),
  state: componentDataStateSchema,
  declared: z.array(z.string()),
  /** Применены полностью. */
  applied: z.array(z.string()),
  /** Не применены или откачены — база отстаёт от кода. */
  pending: z.array(z.string()),
  /** Начаты и не завершены — нужно вмешательство человека (`prisma migrate resolve`). */
  failed: z.array(z.string())
});
export type ComponentDataStatus = z.infer<typeof componentDataStatusSchema>;

/** Строка `_prisma_migrations`, которая нужна для решения. */
export interface AppliedMigrationRow {
  name: string;
  finishedAt: Date | string | null;
  rolledBackAt: Date | string | null;
}

/**
 * `rows === null` — таблицу миграций прочитать не удалось: честно «неизвестно», а не «всё в порядке».
 * Приоритет состояний: failed → pending → ok.
 */
export function componentDataStatus(componentId: string, declared: readonly string[], rows: readonly AppliedMigrationRow[] | null): ComponentDataStatus {
  if (rows === null) return { componentId, state: "unknown", declared: [...declared], applied: [], pending: [], failed: [] };
  const byName = new Map(rows.map((row) => [row.name, row]));
  const applied: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  for (const name of declared) {
    const row = byName.get(name);
    if (!row || row.rolledBackAt) pending.push(name);
    else if (!row.finishedAt) failed.push(name);
    else applied.push(name);
  }
  const state: ComponentDataState = failed.length > 0 ? "failed" : pending.length > 0 ? "pending" : "ok";
  return { componentId, state, declared: [...declared], applied, pending, failed };
}
