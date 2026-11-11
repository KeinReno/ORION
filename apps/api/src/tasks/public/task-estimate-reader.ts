import type { Prisma } from "@prisma/client";

/**
 * Оценка задачи — узкая проекция для план/факта (задание 04). Учёт времени не
 * импортирует полный `TaskOperations`/`TasksService`: тогда Time оставался бы
 * работоспособным без модуля задач, а `time-calendar-contracts` — без полного
 * TasksModule (см. ADR-0030). Здесь только то, что нужно отчёту.
 */
export type TaskEstimate = {
  id: string;
  title: string;
  /** `null` — задача не оценена (это не «ноль минут»). */
  estimatedMinutes: number | null;
};

/** Чтение в транзакции вызывающего: он отвечает за членство и RLS-контекст. */
export abstract class TaskEstimateReader {
  abstract byIdsTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: readonly string[]): Promise<TaskEstimate[]>;
}
