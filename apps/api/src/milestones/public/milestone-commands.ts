import type { Prisma } from "@prisma/client";
import type { CreateMilestoneInput } from "@orion/shared-types";

/** Снимок вехи, нужный копированию структуры проекта (задание 03). */
export type ProjectMilestoneSnapshot = {
  id: string;
  title: string;
  note: string;
  status: string;
  startAt: Date | null;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  order: number;
};

/**
 * Публичная команда модуля milestones (задание 03): создать веху внутри ЧУЖОЙ транзакции
 * и прочитать план проекта для копирования структуры.
 *
 * Зачем контракт: «проект из шаблона» и «дублировать проект» создают вехи атомарно вместе
 * с проектом. Писать `tx.milestone` из модуля projects нельзя (G4: только через контракт
 * владельца). Вызывающий уже авторизовал команду и держит транзакцию/RLS — здесь только
 * вставка/чтение, без собственных проверок членства.
 */
export abstract class MilestoneCommands {
  abstract createTx(tx: Prisma.TransactionClient, workspaceId: string, input: CreateMilestoneInput): Promise<{ id: string }>;
  /** Вехи проекта по порядку Гантта — источник для копии структуры (не архив и не фильтр по статусу). */
  abstract listByProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<ProjectMilestoneSnapshot[]>;
}
