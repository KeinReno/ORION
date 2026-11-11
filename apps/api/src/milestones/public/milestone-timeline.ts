import type { Prisma } from "@prisma/client";

/**
 * Вехи проекта — проекция для Гантта планирования (задание 04). Владелец вех —
 * `milestones/`; планирование не читает `milestones` само, а получает ровно то,
 * что нужно шкале: окно, оценку, порядок и finish-to-start связи.
 */
export type MilestoneTimelineItem = {
  id: string;
  title: string;
  /** planned | in_progress | done */
  status: string;
  startAt: Date | null;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  order: number;
  /** Вехи, которые должны закончиться раньше этой. */
  dependencyIds: string[];
};

/** Чтение в транзакции вызывающего: он же отвечает за членство и RLS-контекст. */
export abstract class MilestoneTimelineReader {
  abstract byProjectTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string
  ): Promise<MilestoneTimelineItem[]>;
  /**
   * Вехи по id — для оценки последствий переноса: затронутые задачи могут быть
   * из разных проектов, и запрашивать их вехи проектом нельзя.
   */
  abstract byIdsTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    milestoneIds: readonly string[]
  ): Promise<Array<{ id: string; title: string; dueAt: Date | null }>>;
}
