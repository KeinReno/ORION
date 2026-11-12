import { Injectable } from "@nestjs/common";
import type { BackgroundJobDefinition } from "@orion/shared-types";

/**
 * Foundation Core (task 01.3): declarative catalog of the @Cron entry points that run in this
 * process. A job is registered once (component + name + schedule); the supervisor gates its runs
 * on the component being enabled in a workspace and the state is exposed by `GET system/jobs`.
 *
 * Existing `@Cron` services stay decorator-driven — Nest owns their schedules — but every entry
 * point must appear here so diagnostics and the lifecycle gate see the same list. A new job adds
 * one row here and wraps its body in `BackgroundJobSupervisor.runWorkspaceJob` when it has a
 * workspace scope.
 */
export const BACKGROUND_JOB_CATALOG: readonly BackgroundJobDefinition[] = [
  { componentId: "tasks", jobName: "due-tasks", schedule: "cron", description: "Просроченные задачи: уведомление и лента" },
  { componentId: "calendar", jobName: "event-reminders", schedule: "cron", description: "Напоминания событий" },
  { componentId: "calendar", jobName: "calendar-feeds-sync", schedule: "cron", description: "Синхронизация внешних ICS-фидов" },
  { componentId: "finance", jobName: "recurring-transactions", schedule: "cron", description: "Материализация повторяющихся платежей" },
  { componentId: "contacts", jobName: "contact-reminders", schedule: "cron", description: "Дни рождения и «пора связаться»" },
  { componentId: "notes", jobName: "trash-purge", schedule: "cron", description: "Чистка корзины заметок" },
  { componentId: "notes", jobName: "revision-prune", schedule: "cron", description: "Прореживание ревизий заметок" },
  { componentId: "documents", jobName: "trash-purge", schedule: "cron", description: "Чистка корзины документов и блобов" },
  { componentId: "core", jobName: "entity-reminders", schedule: "cron", description: "Доставка напоминаний об объектах" },
  { componentId: "core", jobName: "domain-events-dispatch", schedule: "cron", description: "Раскладка и доставка outbox доменных событий" },
  { componentId: "core", jobName: "domain-events-purge", schedule: "cron", description: "Чистка доставленных доменных событий" },
  { componentId: "core", jobName: "sync-purge", schedule: "cron", description: "Обслуживание журнала синхронизации" },
  { componentId: "core", jobName: "publication-rule-reconcile", schedule: "cron", description: "Сверка правил публикации" },
  { componentId: "chat-archive", jobName: "auto-discovery", schedule: "cron", description: "Поиск источников архива чатов" }
];

@Injectable()
export class BackgroundJobRegistry {
  private readonly definitions = new Map<string, BackgroundJobDefinition>();

  constructor() {
    for (const definition of BACKGROUND_JOB_CATALOG) this.register(definition);
  }

  /** Stable key used by both the registry and `BackgroundJobStatus`. */
  static key(componentId: string, jobName: string): string {
    return `${componentId}/${jobName}`;
  }

  register(definition: BackgroundJobDefinition): void {
    const key = BackgroundJobRegistry.key(definition.componentId, definition.jobName);
    const existing = this.definitions.get(key);
    if (existing) {
      if (existing.schedule !== definition.schedule || existing.description !== definition.description) {
        throw new Error(`Фоновая задача ${key} уже зарегистрирована с другими параметрами`);
      }
      return;
    }
    this.definitions.set(key, presentation(definition));
  }

  list(): BackgroundJobDefinition[] {
    return [...this.definitions.values()].sort(
      (a, b) => a.componentId.localeCompare(b.componentId) || a.jobName.localeCompare(b.jobName)
    );
  }
}

function presentation(definition: BackgroundJobDefinition): BackgroundJobDefinition {
  return {
    componentId: definition.componentId,
    jobName: definition.jobName,
    schedule: definition.schedule,
    description: definition.description
  };
}
