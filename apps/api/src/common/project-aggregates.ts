import { Global, Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { OrionModuleId, ProjectActivity } from "@orion/shared-types";

/**
 * «Провайдер агрегата» (PLATFORM_AUDIT G4): модуль-владелец данных сам умеет ответить, что у него есть по
 * проектам, и регистрируется здесь. `projects` спрашивает провайдеров и не знает ни таблиц задач/заметок/событий/
 * документов/склада/финансов/времени/вех, ни их модулей поимённо — отсюда правило architecture-check
 * «сервис модуля не использует чужие `tx.<модель>`».
 */

/** Вклад одного модуля в карточку одного проекта. Поле отсутствует — модуль этого не умеет сообщать. */
export interface ProjectAggregate {
  /** Сколько объектов модуля привязано к проекту (заметки, события, документы, склад). */
  count?: number;
  /** Статусы задач проекта: основа прогресса и счётчиков. */
  taskStatusCounts?: Array<{ status: string; count: number }>;
  /**
   * Задание 03 (портфель): открытые задачи проекта по исполнителям —
   * `assigneeId` — это `WorkspaceMember.id` (или null для «не назначено»).
   * Считает владелец задач, чтобы projects не читал чужую таблицу.
   */
  openTasksByAssignee?: Array<{ assigneeId: string | null; count: number }>;
  /**
   * Задание 03 (портфель): вехи проекта БЕЗ срока (`dueAt = null`) — риск «веха без даты».
   * Заголовки, а не id: портфель показывает их человеку в списке рисков.
   */
  milestonesWithoutDates?: string[];
  /** Сумма оценок задач; отсутствует, если оценок нет вовсе («не оценено», а не 0). */
  plannedMinutes?: number;
  /** Расходы по валютам источника (копейки): суммировать разные валюты нельзя. */
  spent?: Array<{ currency: string; amount: number }>;
  /** Учтённые минуты (идущий таймер считается по `now`). */
  trackedMinutes?: number;
  /** Самое свежее касание объектов модуля в проекте. */
  lastActivityAt?: Date;
}

export interface ProjectAggregateProvider {
  /** Ключ вклада (совпадает с id модуля-владельца): по нему projects раскладывает счётчики в свой DTO. */
  readonly id: string;
  /** Модуль-владелец: если он выключен в пространстве, провайдер не спрашивается; `null` — всегда включён. */
  readonly moduleId: OrionModuleId | null;
  /** Порядок слияния ленты активности при равных временах (фиксирует прежний порядок ответа). */
  readonly order: number;
  aggregate?(tx: Prisma.TransactionClient, projectIds: string[], now: Date): Promise<Map<string, ProjectAggregate>>;
  recentActivity?(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]>;
}

@Injectable()
export class ProjectAggregateRegistry {
  private readonly items = new Map<string, ProjectAggregateProvider>();

  register(provider: ProjectAggregateProvider): void {
    if (this.items.has(provider.id)) throw new Error(`Duplicate project aggregate provider: ${provider.id}`);
    this.items.set(provider.id, provider);
  }

  providers(): ProjectAggregateProvider[] {
    return [...this.items.values()].sort((a, b) => a.order - b.order);
  }
}

/** Глобальный, как BackgroundJobsModule: модули-владельцы регистрируются без лишних импортов. */
@Global()
@Module({ providers: [ProjectAggregateRegistry], exports: [ProjectAggregateRegistry] })
export class ProjectAggregateModule {}

/** Для провайдеров «счётчик + последнее касание»: два groupBy по projectId сводятся в одну карту. */
export function countAndLatestByProject(
  counts: Array<{ projectId: string | null; _count: number }>,
  latest: Array<{ projectId: string | null; _max: { updatedAt: Date | null } }>
): Map<string, ProjectAggregate> {
  const map = new Map<string, ProjectAggregate>();
  const entryOf = (projectId: string): ProjectAggregate => map.get(projectId) ?? map.set(projectId, {}).get(projectId)!;
  for (const entry of counts) if (entry.projectId) entryOf(entry.projectId).count = entry._count;
  for (const entry of latest) if (entry.projectId && entry._max.updatedAt) entryOf(entry.projectId).lastActivityAt = entry._max.updatedAt;
  return map;
}
