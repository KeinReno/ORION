import { Prisma } from "@prisma/client";

/**
 * Starter content for a solo-developer kernel: one product project, a short
 * operating loop (inbox → tasks → time), and the modules that don't belong
 * to writing code turned off. Disable ≠ delete — finance/inventory come back
 * from Настройки → Модули without losing anything.
 */
export async function seedSoloDeveloperWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  const project = await tx.project.create({
    data: {
      workspaceId,
      name: "ORION",
      color: "indigo",
      description:
        "Персональное ядро соло-разработчика: задачи, заметки, календарь и время в одном пространстве. Не стартап и не команда — один человек ведёт продукт.",
      contextNote:
        "Последнее: после входа выбирается пространство, а не сразу дашборд. Дальше — живой день через инбокс и `pnpm quality` перед коммитом."
    }
  });

  const now = Date.now();
  const todayEnd = new Date();
  todayEnd.setHours(20, 0, 0, 0);
  const tomorrow = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);

  await tx.task.createMany({
    data: [
      {
        workspaceId,
        projectId: project.id,
        title: "Держать ядро живым",
        description: "Перед коммитом: `pnpm quality`. Не коммитить `.env` и кэш сборки.",
        status: "in_progress",
        priority: "high",
        projectTag: "ORION",
        sortOrder: 0,
        dueAt: todayEnd,
        estimatedMinutes: 60
      },
      {
        workspaceId,
        projectId: project.id,
        title: "Разобрать инбокс до пустой очереди",
        description: "Захват как есть → «на сегодня» / задача / заметка. Не оставлять мысли только в голове.",
        status: "todo",
        priority: "high",
        projectTag: "ORION",
        sortOrder: 1,
        dueAt: todayEnd,
        estimatedMinutes: 25
      },
      {
        workspaceId,
        projectId: project.id,
        title: "Закрыть день таймером",
        description: "Хотя бы один отрезок на задаче ORION — иначе «что я делал» не из чего сложить.",
        status: "todo",
        priority: "normal",
        projectTag: "ORION",
        sortOrder: 2,
        dueAt: tomorrow,
        estimatedMinutes: 120
      },
      {
        workspaceId,
        projectId: project.id,
        title: "Настроить WebDAV-бэкап, когда появится удалёнка",
        description: "Пока нет шарa — не выдумывать второй канал синхронизации. Offline-sync в ядре сознательно нет.",
        status: "backlog",
        priority: "low",
        projectTag: "ORION",
        sortOrder: 3
      },
      {
        workspaceId,
        projectId: project.id,
        title: "Выбор пространства после входа",
        description: "Сделано: логин → /spaces → работа. Не открывать дашборд, пока пространство не выбрано.",
        status: "done",
        priority: "normal",
        projectTag: "ORION",
        sortOrder: 4,
        completedAt: new Date(now - 60 * 60 * 1000)
      }
    ]
  });

  const pinnedAt = new Date();
  await tx.note.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "Как устроено ядро",
      tags: ["ядро", "orion"],
      pinnedAt,
      editedAt: pinnedAt,
      body: [
        "ORION — модульный монолит: NestJS + Prisma + Postgres, общий TS-клиент для веба и Tauri.",
        "",
        "- Контракт — zod в `packages/shared-types`.",
        "- Изоляция — `assertMember` **и** RLS через `PrismaService.withUser`.",
        "- Панель модуля — `apps/web/panels`, реестр — `panel-registry.ts`, не сайдбар.",
        "- Выключенный модуль не удаляет данные.",
        "",
        "Подробности: `CLAUDE.md` и `docs/PLAN.md`. Соседние заметки: [[Правила соло]]."
      ].join("\n")
    }
  });
  await tx.note.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "Правила соло",
      tags: ["соло", "ритуал"],
      pinnedAt: new Date(pinnedAt.getTime() + 1000),
      editedAt: pinnedAt,
      body: [
        "1. Один инбокс. Мысль сначала туда, не в чат с собой.",
        "2. Один проект продукта — ORION. Чужие заказы — другое пространство.",
        "3. Сегодня = просроченное + фокус + таймер, не бесконечный канбан.",
        "4. Перед коммитом `pnpm quality`. Новая таблица с `workspaceId` — сразу RLS.",
        "5. Не чинить осознанные упрощения из PLAN (offline, мобильный клиент, бизнес-логика в Tauri).",
        "",
        "См. [[Как устроено ядро]]."
      ].join("\n")
    }
  });
  await tx.note.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "Ежедневная",
      isTemplate: true,
      tags: ["шаблон"],
      editedAt: pinnedAt,
      body: ["## Сделал", "- ", "", "## Застрял", "- ", "", "## Завтра", "- "].join("\n")
    }
  });

  await tx.inboxItem.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "Что не вошло в задачи — сбросить сюда, не держать в голове",
      body: "Это стартовый захват. Разберите его или удалите, когда очередь станет своей."
    }
  });

  await tx.habit.createMany({
    data: [
      {
        workspaceId,
        name: "Писать код",
        note: "Хотя бы один осмысленный коммит или час за задачей ORION.",
        weekdays: [0, 1, 2, 3, 4],
        color: "indigo"
      },
      {
        workspaceId,
        name: "Закрыть день",
        note: "Инбокс пуст или сознательно отложен. Таймер остановлен.",
        weekdays: [],
        color: "teal"
      },
      {
        workspaceId,
        name: "Пятничный разбор",
        note: "Что ушло в прод/в ядро за неделю, что в бэклог.",
        weekdays: [4],
        color: "amber"
      }
    ]
  });

  const checklist = await tx.list.create({
    data: { workspaceId, name: "Перед коммитом" }
  });
  await tx.listItem.createMany({
    data: [
      { workspaceId, listId: checklist.id, label: "`pnpm quality` зелёный" },
      { workspaceId, listId: checklist.id, label: "Нет секретов и `.env` в диффе" },
      { workspaceId, listId: checklist.id, label: "Новая таблица с workspaceId — есть RLS-миграция" },
      { workspaceId, listId: checklist.id, label: "Пользовательские строки по-русски" }
    ]
  });
  const ideas = await tx.list.create({
    data: { workspaceId, name: "Идеи — не сейчас" }
  });
  await tx.listItem.createMany({
    data: [
      { workspaceId, listId: ideas.id, label: "Мобильный клиент" },
      { workspaceId, listId: ideas.id, label: "Офлайн-синк / outbox" },
      { workspaceId, listId: ideas.id, label: "S3 как третий драйвер документов" }
    ]
  });

  const friday = nextUtcDateWithWeekday(4);
  const saturday = new Date(friday.getTime() + 86_400_000);
  await tx.event.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "Еженедельный разбор ORION",
      description: "Что сдвинулось в ядре, что сознательно не делаем, что в инбоксе.",
      allDay: true,
      startAt: friday,
      endAt: saturday,
      colorTag: "indigo",
      tz: "Europe/Moscow",
      reminders: [540],
      recurrence: {
        freq: "weekly",
        interval: 1,
        byWeekday: [4],
        until: null,
        count: null
      }
    }
  });
}

/** UTC midnight of the next `weekday` (0 = Monday … 6 = Sunday). Today counts if it matches. */
function nextUtcDateWithWeekday(weekday: number): Date {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const js = new Date(start).getUTCDay();
  const current = js === 0 ? 6 : js - 1;
  const delta = (weekday - current + 7) % 7;
  return new Date(start + delta * 86_400_000);
}
