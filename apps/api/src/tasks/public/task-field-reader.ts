import type { Prisma } from "@prisma/client";

/**
 * Пользовательские поля задач (Tasks 2.0, задание 02) — узкая проекция для чужих
 * представлений. Владелец полей — `tasks/`: планирование (задание 04) строит на
 * них оси матрицы, но не читает `task_field_definitions`/`task_field_values`
 * само (иначе отключение или переименование модели Tasks молча ломало бы план).
 *
 * Значения приводятся к скаляру: ось матрицы — одно число/строка/флаг, а
 * `multi`-поле осью быть не может и честно получает `null`.
 */
export type TaskFieldSummary = {
  id: string;
  name: string;
  /** text | number | date | select | multi | checkbox | url */
  type: string;
  /** all | project */
  applicability: string;
  projectId: string | null;
};

export type TaskFieldScalar = number | string | boolean | null;

/** `taskId → fieldId → значение`. */
export type TaskFieldValueMap = Record<string, Record<string, TaskFieldScalar>>;

/** Чтение в транзакции вызывающего (RLS и авторизация — его). */
export abstract class TaskFieldReader {
  abstract fieldsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<TaskFieldSummary[]>;
  abstract valuesTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: readonly string[]): Promise<TaskFieldValueMap>;
}
