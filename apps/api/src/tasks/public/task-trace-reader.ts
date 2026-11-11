import type { Prisma } from "@prisma/client";

/**
 * Публичный срез задачи для таймлайна (задание 11.2, `GET tasks/:id/trace`).
 *
 * Модуль development не читает `tasks`/`task_activities` напрямую (G4): он получает ровно те поля,
 * которые нужны цепочке «создание → поручение → изменения → коммиты → проверки → релиз», и сам
 * решает, как их показать. Запрос выполняется в транзакции вызывающего — членство и RLS остаются
 * его заботой.
 */
export interface TaskTraceActivity {
  id: string;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  /** Имя агента, если изменение пришло через AI Bridge; иначе `null`. */
  agentName: string | null;
  actorName: string | null;
}

export interface TaskTraceSource {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  assigneeName: string | null;
  activities: TaskTraceActivity[];
}

/**
 * Ссылка на задачу из внешнего текста (сообщение коммита, `#42`): номер по порядку создания внутри
 * пространства или начало uuid. Разрешение — у владельца задачи: чужая/несуществующая ссылка
 * просто не находится, и development ничего не связывает.
 */
export type TaskReferenceLookup = { ordinal: number } | { idPrefix: string };

export abstract class TaskTraceReader {
  abstract traceSourceTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskTraceSource | null>;
  abstract resolveReferenceTx(tx: Prisma.TransactionClient, workspaceId: string, lookup: TaskReferenceLookup): Promise<string | null>;
}
